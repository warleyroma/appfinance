import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "MVP · Quanto Posso Gastar" },
      {
        name: "description",
        content:
          "Protótipo funcional do assistente financeiro: registre salário, contas fixas, cartões e lançamentos, e descubra quanto pode gastar hoje.",
      },
      { property: "og:title", content: "MVP — Quanto Posso Gastar" },
      {
        property: "og:description",
        content:
          "Protótipo navegável do case público: cálculo diário de disponibilidade considerando cartões, fechamentos e vencimentos.",
      },
    ],
  }),
  component: AppMvp,
});

// ---------- Tipos ----------
type Card = {
  id: string;
  nome: string;
  limite: number;
  fechamento: number; // dia do mês
  vencimento: number; // dia do mês
};

type Fixa = { id: string; nome: string; valor: number; diaVencimento: number };

type TipoLanc = "debito" | "credito_avista" | "credito_parcelado";

type Lancamento = {
  id: string;
  descricao: string;
  valor: number;
  data: string; // ISO yyyy-mm-dd
  tipo: TipoLanc;
  cardId?: string;
  parcelas?: number; // total de parcelas (para credito_parcelado)
  terceiro?: boolean; // gasto de terceiro no seu cartão — não entra no cálculo pessoal
  terceiroNome?: string;
};

type ModoSalario = "dia_fixo" | "dia_util";

type Estado = {
  salario: number;
  ticketTransporte?: number;
  adiantamento?: number; // Novo campo para o vale/quinzena
  diaAdiantamento?: number; // Novo campo para o dia do vale
  modoSalario: ModoSalario;
  diaSalario: number; // usado quando modo = dia_fixo
  diaUtilSalario: number; // usado quando modo = dia_util (ex.: 5 = 5º dia útil)
  fixas: Fixa[];
  cards: Card[];
  lancamentos: Lancamento[];
};

const STORAGE_KEY = "qpg.mvp.v2";

const estadoInicial: Estado = {
  salario: 0,
  ticketTransporte: 0,
  adiantamento: 0, // inicializado com zero
  diaAdiantamento: 15, // inicializado por padrão no dia 15
  modoSalario: "dia_fixo",
  diaSalario: 5,
  diaUtilSalario: 5,
  fixas: [],
  cards: [],
  lancamentos: [],
};

// ---------- Utilidades ----------
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const uid = () => Math.random().toString(36).slice(2, 10);

function ehDiaUtil(d: Date) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6; // ignora sáb/dom (feriados nacionais ficam para depois)
}

// Retorna a data do N-ésimo dia útil do mês/ano informado
function nthDiaUtil(ano: number, mes: number, n: number) {
  const d = new Date(ano, mes, 1);
  let count = 0;
  while (d.getMonth() === mes) {
    if (ehDiaUtil(d)) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
  // fallback: último dia do mês
  return new Date(ano, mes + 1, 0);
}

function proximaData(diaAlvo: number, base: Date) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const ano = d.getFullYear();
  const mes = d.getMonth();
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const dia = Math.min(diaAlvo, ultimoDia);
  let alvo = new Date(ano, mes, dia);
  if (alvo < d) {
    const ultimoProx = new Date(ano, mes + 2, 0).getDate();
    alvo = new Date(ano, mes + 1, Math.min(diaAlvo, ultimoProx));
  }
  return alvo;
}

function proximoDiaUtilSalario(n: number, base: Date) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const atual = nthDiaUtil(d.getFullYear(), d.getMonth(), n);
  if (atual >= d) return atual;
  return nthDiaUtil(d.getFullYear(), d.getMonth() + 1, n);
}

// Calcula dias entre datas de forma segura
function diasEntre(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// Fatura em aberto do cartão (apenas gastos próprios, ignora terceiros)
function faturaAberta(card: Card, lancs: Lancamento[], hoje: Date) {
  const ultimoFech = (() => {
    const d = new Date(hoje);
    d.setHours(0, 0, 0, 0);
    const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const diaF = Math.min(card.fechamento, ultimoDia);
    let f = new Date(d.getFullYear(), d.getMonth(), diaF);
    if (f > d) f = new Date(d.getFullYear(), d.getMonth() - 1, diaF);
    return f;
  })();

  return lancs
    .filter(
      (l) =>
        (l.tipo === "credito_avista" || l.tipo === "credito_parcelado") &&
        l.cardId === card.id &&
        !l.terceiro,
    )
    .filter((l) => new Date(l.data) > ultimoFech && new Date(l.data) <= hoje)
    .reduce((s, l) => s + l.valor / (l.parcelas || 1), 0);
}

// Total lançado no cartão (incluindo terceiros) — para mostrar uso real do limite
function faturaTotalCartao(card: Card, lancs: Lancamento[], hoje: Date) {
  const ultimoFech = (() => {
    const d = new Date(hoje);
    d.setHours(0, 0, 0, 0);
    const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const diaF = Math.min(card.fechamento, ultimoDia);
    let f = new Date(d.getFullYear(), d.getMonth(), diaF);
    if (f > d) f = new Date(d.getFullYear(), d.getMonth() - 1, diaF);
    return f;
  })();

  return lancs
    .filter(
      (l) =>
        (l.tipo === "credito_avista" || l.tipo === "credito_parcelado") &&
        l.cardId === card.id,
    )
    .filter((l) => new Date(l.data) > ultimoFech && new Date(l.data) <= hoje)
    .reduce((s, l) => s + l.valor / (l.parcelas || 1), 0);
}

// ---------- Componente ----------
function AppMvp() {
  const [estado, setEstado] = useState<Estado>(estadoInicial);
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEstado({ ...estadoInicial, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
    setHidratado(true);
  }, []);

  useEffect(() => {
    if (hidratado) localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
  }, [estado, hidratado]);

  const hoje = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const calculo = useMemo(() => {
    // 1. Calcula o próximo pagamento principal (salário)
    const proxPagamentoPrincipal =
      estado.modoSalario === "dia_util"
        ? proximoDiaUtilSalario(estado.diaUtilSalario, hoje)
        : proximaData(estado.diaSalario, hoje);

    // 2. Calcula o próximo adiantamento (caso exista)
    const temAdiantamento = (estado.adiantamento || 0) > 0;
    const proxAdiantamento = temAdiantamento
      ? proximaData(estado.diaAdiantamento || 15, hoje)
      : null;

    // 3. O fechamento do ciclo atual de gastos será na data de recebimento mais próxima
    const proxSalario = proxAdiantamento && proxAdiantamento < proxPagamentoPrincipal
      ? proxAdiantamento
      : proxPagamentoPrincipal;

    const diasAte = diasEntre(hoje, proxSalario);

    // 4. Mapeia contas fixas que vencem estritamente dentro deste subciclo ativo
    const fixasFuturas = estado.fixas.reduce((s, f) => {
      const venc = proximaData(f.diaVencimento, hoje);
      return venc <= proxSalario ? s + f.valor : s;
    }, 0);

    const debitoCiclo = estado.lancamentos
      .filter((l) => l.tipo === "debito" && !l.terceiro)
      .filter((l) => {
        const d = new Date(l.data);
        return diasEntre(d, hoje) <= 30 && d <= hoje;
      })
      .reduce((s, l) => s + l.valor, 0);

    const faturas = estado.cards.reduce(
      (s, c) => s + faturaAberta(c, estado.lancamentos, hoje),
      0,
    );

    const gastosTerceiros = estado.lancamentos
      .filter((l) => l.terceiro)
      .reduce((s, l) => s + l.valor / (l.parcelas || 1), 0);

    // 5. Define qual é a Renda Ativa que está financiando este ciclo atual:
    // Se o próximo dinheiro a cair for o Adiantamento, estamos vivendo do Salário + VT.
    // Se o próximo dinheiro a cair for o Salário, estamos vivendo apenas do Adiantamento.
    const rendaCicloAtivo = temAdiantamento && proxSalario === proxPagamentoPrincipal
      ? (estado.adiantamento || 0)
      : estado.salario + (estado.ticketTransporte || 0);

    const disponivelCiclo = Math.max(
      0,
      rendaCicloAtivo - fixasFuturas - debitoCiclo - faturas,
    );
    const porDia = disponivelCiclo / diasAte;

    // Apenas informativo: soma mensal de todas as receitas
    const rendaMensalTotal = estado.salario + (estado.ticketTransporte || 0) + (estado.adiantamento || 0);

    return {
      proxSalario,
      diasAte,
      fixasFuturas,
      debitoCiclo,
      faturas,
      gastosTerceiros,
      disponivelCiclo,
      porDia,
      rendaTotal: rendaCicloAtivo,
      rendaMensalTotal,
    };
  }, [estado, hoje]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Voltar ao roadmap
      </Link>

      <header className="mt-6">
        <p className="text-sm uppercase tracking-[0.2em] text-accent">
          MVP · Protótipo funcional
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl">
          Quanto você pode gastar <em className="text-accent">hoje</em>?
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Preencha os dados abaixo. Tudo fica salvo no seu navegador (localStorage). Sem cadastro,
          sem backend — é a validação da tese antes da engenharia completa.
        </p>
      </header>

      {/* HERO CÁLCULO */}
      <section className="mt-10 rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Disponível por dia até {calculo.proxSalario.toLocaleString("pt-BR", { day: "2-digit", month: "short" })}
        </p>
        <p className="mt-2 font-serif text-6xl text-foreground">
          {brl(calculo.porDia)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {calculo.diasAte} {calculo.diasAte === 1 ? "dia restante" : "dias restantes"} no ciclo ·
          total disponível <strong className="text-foreground">{brl(calculo.disponivelCiclo)}</strong>
          {calculo.gastosTerceiros > 0 && (
            <>
              {" "}· <span className="text-accent">{brl(calculo.gastosTerceiros)}</span> em gastos de terceiros (ignorados)
            </>
          )}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <Metric label="Renda do Ciclo" valor={calculo.rendaTotal} />
          <Metric label="Contas fixas" valor={calculo.fixasFuturas} negative />
          <Metric label="Débito no ciclo" valor={calculo.debitoCiclo} negative />
          <Metric label="Faturas abertas" valor={calculo.faturas} negative />
        </div>
      </section>

      {/* SETUP */}
      <Bloco titulo="1. Renda e ciclo">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Salário líquido restante (R$)">
            <input
              type="number"
              value={estado.salario || ""}
              onChange={(e) =>
                setEstado((s) => ({ ...s, salario: Number(e.target.value) || 0 }))
              }
              className={inputCls}
              placeholder="Ex.: R$ 3.000"
            />
          </Field>
          <Field label="Ticket Transporte / VT (R$)">
            <input
              type="number"
              value={estado.ticketTransporte || ""}
              onChange={(e) =>
                setEstado((s) => ({ ...s, ticketTransporte: Number(e.target.value) || 0 }))
              }
              className={inputCls}
              placeholder="Ex.: R$ 500"
            />
          </Field>
          <Field label="Adiantamento / Vale / Quinzena (R$)">
            <input
              type="number"
              value={estado.adiantamento || ""}
              onChange={(e) =>
                setEstado((s) => ({ ...s, adiantamento: Number(e.target.value) || 0 }))
              }
              className={inputCls}
              placeholder="Ex.: R$ 2.000"
            />
          </Field>
          <Field label="Dia do adiantamento">
            <input
              type="number"
              min={1}
              max={31}
              value={estado.diaAdiantamento}
              onChange={(e) =>
                setEstado((s) => ({ ...s, diaAdiantamento: Number(e.target.value) || 15 }))
              }
              className={inputCls}
            />
          </Field>
          <Field label="Como você recebe o salário?">
            <select
              value={estado.modoSalario}
              onChange={(e) =>
                setEstado((s) => ({ ...s, modoSalario: e.target.value as ModoSalario }))
              }
              className={inputCls}
            >
              <option value="dia_fixo">Dia fixo do mês (ex.: todo dia 5)</option>
              <option value="dia_util">Dia útil (ex.: 5º dia útil)</option>
            </select>
          </Field>
          {estado.modoSalario === "dia_fixo" ? (
            <Field label="Dia do recebimento">
              <input
                type="number"
                min={1}
                max={31}
                value={estado.diaSalario}
                onChange={(e) =>
                  setEstado((s) => ({ ...s, diaSalario: Number(e.target.value) || 1 }))
                }
                className={inputCls}
              />
            </Field>
          ) : (
            <Field label="Qual dia útil? (1 a 10)">
              <input
                type="number"
                min={1}
                max={10}
                value={estado.diaUtilSalario}
                onChange={(e) =>
                  setEstado((s) => ({ ...s, diaUtilSalario: Number(e.target.value) || 1 }))
                }
                className={inputCls}
              />
            </Field>
          )}
        </div>
        {(estado.modoSalario === "dia_util" || (estado.adiantamento || 0) > 0) && (
          <p className="mt-3 text-xs text-muted-foreground">
            Próxima entrada financeira prevista para:{" "}
            <strong className="text-foreground">
              {calculo.proxSalario.toLocaleString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </strong>{" "}
            ({calculo.diasAte} {calculo.diasAte === 1 ? "dia restante" : "dias restantes"}).
            {estado.adiantamento && estado.adiantamento > 0 && (
              <span> Renda mensal total acumulada: <strong className="text-foreground">{brl(calculo.rendaMensalTotal)}</strong>.</span>
            )}
          </p>
        )}
      </Bloco>

      {/* FIXAS */}
      <Bloco titulo="2. Contas fixas">
        <Lista
          items={estado.fixas}
          empty="Nenhuma conta fixa cadastrada."
          render={(f) => (
            <>
              <div>
                <p className="text-foreground">{f.nome}</p>
                <p className="text-xs text-muted-foreground">Vence dia {f.diaVencimento}</p>
              </div>
              <p className="text-foreground">{brl(f.valor)}</p>
            </>
          )}
          onRemove={(id) =>
            setEstado((s) => ({ ...s, fixas: s.fixas.filter((x) => x.id !== id) }))
          }
        />
        <FormFixa
          onAdd={(f) => setEstado((s) => ({ ...s, fixas: [...s.fixas, { ...f, id: uid() }] }))}
        />
      </Bloco>

      {/* CARDS */}
      <Bloco titulo="3. Cartões de crédito">
        <p className="mb-4 text-sm text-muted-foreground">
          <strong className="text-foreground">Fechamento</strong> é o dia em que o cartão fecha a
          fatura do mês — tudo comprado depois dessa data cai na fatura seguinte.{" "}
          <strong className="text-foreground">Vencimento</strong> é o dia em que essa fatura
          precisa ser paga. Ex.: fecha dia 25, vence dia 5 do mês seguinte.
        </p>
        <Lista
          items={estado.cards}
          empty="Nenhum cartão cadastrado."
          render={(c) => {
            const fat = faturaAberta(c, estado.lancamentos, hoje);
            const total = faturaTotalCartao(c, estado.lancamentos, hoje);
            const terceiro = total - fat;
            return (
              <>
                <div>
                  <p className="text-foreground">{c.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    Fecha dia {c.fechamento} · vence dia {c.vencimento} · limite {brl(c.limite)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-foreground">{brl(fat)}</p>
                  <p className="text-xs text-muted-foreground">
                    fatura em aberto (sua)
                    {terceiro > 0.005 && (
                      <> · +{brl(terceiro)} de terceiros</>
                    )}
                  </p>
                </div>
              </>
            );
          }}
          onRemove={(id) =>
            setEstado((s) => ({ ...s, cards: s.cards.filter((x) => x.id !== id) }))
          }
        />
        <FormCard
          onAdd={(c) => setEstado((s) => ({ ...s, cards: [...s.cards, { ...c, id: uid() }] }))}
        />
      </Bloco>

      {/* LANÇAMENTOS */}
      <Bloco titulo="4. Lançamentos">
        <Lista
          items={[...estado.lancamentos].sort((a, b) => (a.data < b.data ? 1 : -1))}
          empty="Nenhum lançamento ainda."
          render={(l) => {
            const c = estado.cards.find((x) => x.id === l.cardId);
            const tipoLabel =
              l.tipo === "debito"
                ? "débito"
                : l.tipo === "credito_avista"
                  ? `${c?.nome ?? "cartão"} · à vista`
                  : `${c?.nome ?? "cartão"} · ${l.parcelas || 1}`;
            return (
              <>
                <div>
                  <p className="text-foreground">
                    {l.descricao}
                    {l.terceiro && (
                      <span className="ml-2 rounded bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                        terceiro{l.terceiroNome ? ` · ${l.terceiroNome}` : ""}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(l.data).toLocaleDateString("pt-BR")} · {tipoLabel}
                  </p>
                </div>
                <p className={`text-foreground ${l.terceiro ? "opacity-60" : ""}`}>{brl(l.valor)}</p>
              </>
            );
          }}
          onRemove={(id) =>
            setEstado((s) => ({
              ...s,
              lancamentos: s.lancamentos.filter((x) => x.id !== id),
            }))
          }
        />
        <FormLanc
          cards={estado.cards}
          onAdd={(l) =>
            setEstado((s) => ({ ...s, lancamentos: [...s.lancamentos, { ...l, id: uid() }] }))
          }
        />
      </Bloco>

      <div className="mt-16 flex items-center justify-between border-t border-border pt-6 text-sm text-muted-foreground">
        <span>Protótipo local · sem backend</span>
        <button
          onClick={() => {
            if (confirm("Zerar todos os dados?")) setEstado(estadoInicial);
          }}
          className="text-destructive hover:underline"
        >
          Zerar dados
        </button>
      </div>
    </main>
  );
}

// ---------- Subcomponentes ----------
const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Metric({ label, valor, negative }: { label: string; valor: number; negative?: boolean }) {
  return (
    <div className="rounded-lg border border-border/70 bg-parchment/50 p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 font-serif text-2xl ${negative ? "text-foreground/80" : "text-foreground"}`}>
        {negative && valor > 0 ? "−" : ""}
        {brl(valor)}
      </p>
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl text-foreground">{titulo}</h2>
      <div className="mt-4 rounded-xl border border-border bg-card p-6">{children}</div>
    </section>
  );
}

function Lista<T extends { id: string }>({
  items,
  empty,
  render,
  onRemove,
}: {
  items: T[];
  empty: string;
  render: (item: T) => React.ReactNode;
  onRemove: (id: string) => void;
}) {
  if (!items.length)
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((it) => (
        <li key={it.id} className="flex items-center justify-between gap-4 py-3">
          <div className="flex-1 flex items-center justify-between gap-4">{render(it)}</div>
          <button
            onClick={() => onRemove(it.id)}
            className="text-xs text-muted-foreground hover:text-destructive"
            aria-label="Remover"
          >
            remover
          </button>
        </li>
      ))}
    </ul>
  );
}

function FormFixa({ onAdd }: { onAdd: (f: Omit<Fixa, "id">) => void }) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [dia, setDia] = useState("10");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!nome || !valor) return;
        onAdd({ nome, valor: Number(valor), diaVencimento: Number(dia) });
        setNome("");
        setValor("");
      }}
      className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_120px_auto]"
    >
      <input placeholder="Ex.: Aluguel" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
      <input placeholder="Valor" type="number" value={valor} onChange={(e) => setValor(e.target.value)} className={inputCls} />
      <input placeholder="Dia" type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} className={inputCls} />
      <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
        Adicionar
      </button>
    </form>
  );
}

function FormCard({ onAdd }: { onAdd: (c: Omit<Card, "id">) => void }) {
  const [nome, setNome] = useState("");
  const [limite, setLimite] = useState("");
  const [fech, setFech] = useState("25");
  const [venc, setVenc] = useState("5");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!nome) return;
        onAdd({
          nome,
          limite: Number(limite) || 0,
          fechamento: Number(fech),
          vencimento: Number(venc),
        });
        setNome("");
        setLimite("");
      }}
      className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_140px_120px_120px_auto]"
    >
      <Field label="Nome do cartão">
        <input placeholder="Ex.: Nubank" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Limite (R$)">
        <input placeholder="0" type="number" value={limite} onChange={(e) => setLimite(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Dia do fechamento">
        <input type="number" min={1} max={31} value={fech} onChange={(e) => setFech(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Dia do vencimento">
        <input type="number" min={1} max={31} value={venc} onChange={(e) => setVenc(e.target.value)} className={inputCls} />
      </Field>
      <div className="flex items-end">
        <button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Adicionar
        </button>
      </div>
    </form>
  );
}

function FormLanc({
  cards,
  onAdd,
}: {
  cards: Card[];
  onAdd: (l: Omit<Lancamento, "id">) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState<TipoLanc>("debito");
  const [cardId, setCardId] = useState<string>("");
  const [parcelas, setParcelas] = useState("2");
  const [data, setData] = useState(hoje);
  const [terceiro, setTerceiro] = useState(false);
  const [terceiroNome, setTerceiroNome] = useState("");

  const ehCredito = tipo === "credito_avista" || tipo === "credito_parcelado";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!descricao || !valor) return;
        if (ehCredito && !cardId) {
          alert("Selecione um cartão");
          return;
        }
        onAdd({
          descricao,
          valor: Number(valor),
          data,
          tipo,
          cardId: ehCredito ? cardId : undefined,
          parcelas: tipo === "credito_parcelado" ? Number(parcelas) : undefined,
          terceiro: terceiro || undefined,
          terceiroNome: terceiro && terceiroNome ? terceiroNome : undefined,
        });
        setDescricao("");
        setValor("");
        setTerceiro(false);
        setTerceiroNome("");
      }}
      className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="Descrição">
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputCls} placeholder="Ex.: Mercado" />
      </Field>
      <Field label="Valor (R$)">
        <input type="number" value={valor} onChange={(e) => setValor(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Tipo">
        <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoLanc)} className={inputCls}>
          <option value="debito">Débito</option>
          <option value="credito_avista">Crédito à vista</option>
          <option value="credito_parcelado">Crédito parcelado</option>
        </select>
      </Field>
      <Field label="Data">
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} />
      </Field>

      {ehCredito && (
        <Field label="Cartão">
          <select value={cardId} onChange={(e) => setCardId(e.target.value)} className={inputCls}>
            <option value="">Selecione…</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </Field>
      )}
      {tipo === "credito_parcelado" && (
        <Field label="Parcelas">
          <input type="number" min={2} value={parcelas} onChange={(e) => setParcelas(e.target.value)} className={inputCls} />
        </Field>
      )}

      <Field label="Gasto de terceiro?">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={terceiro}
            onChange={(e) => setTerceiro(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Não é meu — não contar no cálculo</span>
        </label>
      </Field>
      {terceiro && (
        <Field label="Nome de quem gastou (opcional)">
          <input value={terceiroNome} onChange={(e) => setTerceiroNome(e.target.value)} className={inputCls} placeholder="Ex.: Mãe" />
        </Field>
      )}

      <div className="lg:col-span-4">
        <button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
          Adicionar lançamento
        </button>
      </div>
    </form>
  );
}
