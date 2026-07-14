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
  valor: number; // Para compras novas: valor total. Para em andamento: valor da parcela unitária.
  data: string; // ISO yyyy-mm-dd
  tipo: TipoLanc;
  cardId?: string;
  parcelas?: number; // total de parcelas
  parcelaAtual?: number; // parcela atual (para compras já em andamento, ex: 2)
  emAndamento?: boolean; // indica se é um parcelamento antigo já em andamento
  terceiro?: boolean; // gasto de terceiro no seu cartão
  terceiroNome?: string;
};

type ModoSalario = "dia_fixo" | "dia_util";

type Estado = {
  salario: number;
  ticketTransporte?: number;
  adiantamento?: number;
  diaAdiantamento?: number;
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
  adiantamento: 0,
  diaAdiantamento: 15,
  modoSalario: "dia_fixo",
  diaSalario: 5,
  diaUtilSalario: 5,
  fixas: [],
  cards: [],
  lancamentos: [],
};

// ---------- Utilidades de Formatação ----------
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Máscara de digitação automática estilo aplicativo de banco (centavos automáticos)
function formatarMoedaInput(value: number | string | undefined): string {
  if (value === undefined || value === null || value === 0 || value === "") {
    return "0,00";
  }
  const num = typeof value === "string" ? parseFloat(value.replace(",", ".")) : value;
  if (isNaN(num)) return "0,00";
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const uid = () => Math.random().toString(36).slice(2, 10);

function ehDiaUtil(d: Date) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
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

function diasEntre(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// Encontra a data de fechamento correspondente a uma data de vencimento específica
function obterFechamentoParaVencimento(vencDate: Date, fechDay: number, vencDay: number) {
  const d = new Date(vencDate);
  d.setHours(0, 0, 0, 0);
  if (fechDay >= vencDay) {
    d.setMonth(d.getMonth() - 1);
  }
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(fechDay, ultimoDia));
  return d;
}

// Calcula o valor total devido em uma fatura específica de cartão
function calcularFatura(card: Card, lancs: Lancamento[], vencRef: Date, considerarTerceiros: boolean) {
  const fechRef = obterFechamentoParaVencimento(vencRef, card.fechamento, card.vencimento);
  
  return lancs
    .filter((l) => l.cardId === card.id && (considerarTerceiros || !l.terceiro))
    .reduce((total, l) => {
      const compDate = new Date(l.data);
      compDate.setHours(0, 0, 0, 0);

      if (l.tipo === "credito_avista") {
        const fechAnterior = new Date(fechRef);
        fechAnterior.setMonth(fechAnterior.getMonth() - 1);
        
        if (compDate > fechAnterior && compDate <= fechRef) {
          return total + l.valor;
        }
        return total;
      }

      if (l.tipo === "credito_parcelado") {
        const fechNoMes = new Date(compDate.getFullYear(), compDate.getMonth(), Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 1, 0).getDate()));
        let fechCompra = fechNoMes;
        if (compDate > fechNoMes) {
          fechCompra = new Date(compDate.getFullYear(), compDate.getMonth() + 1, Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 2, 0).getDate()));
        }

        const diffMeses = (fechRef.getFullYear() - fechCompra.getFullYear()) * 12 + (fechRef.getMonth() - fechCompra.getMonth());

        if (l.emAndamento) {
          const parcelaAtualNoCiclo = (l.parcelaAtual || 1) + diffMeses;
          if (parcelaAtualNoCiclo > 0 && parcelaAtualNoCiclo <= (l.parcelas || 1)) {
            return total + l.valor;
          }
        } else {
          if (diffMeses >= 0 && diffMeses < (l.parcelas || 1)) {
            return total + (l.valor / (l.parcelas || 1));
          }
        }
      }

      return total;
    }, 0);
}

function obterLabelParcela(l: Lancamento, card?: Card, hoje?: Date) {
  if (l.tipo !== "credito_parcelado") return "";
  if (!card || !hoje) return `${l.parcelas}x`;
  
  const vencCorrente = proximaData(card.vencimento, hoje);
  const fechRef = obterFechamentoParaVencimento(vencCorrente, card.fechamento, card.vencimento);
  
  const compDate = new Date(l.data);
  compDate.setHours(0, 0, 0, 0);
  
  const fechNoMes = new Date(compDate.getFullYear(), compDate.getMonth(), Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 1, 0).getDate()));
  let fechCompra = fechNoMes;
  if (compDate > fechNoMes) {
    fechCompra = new Date(compDate.getFullYear(), compDate.getMonth() + 1, Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 2, 0).getDate()));
  }
  
  const diffMeses = (fechRef.getFullYear() - fechCompra.getFullYear()) * 12 + (fechRef.getMonth() - fechCompra.getMonth());
  
  const numParcela = l.emAndamento 
    ? (l.parcelaAtual || 1) + diffMeses 
    : diffMeses + 1;
    
  if (numParcela > 0 && numParcela <= (l.parcelas || 1)) {
    return `parcela ${numParcela}/${l.parcelas}`;
  }
  
  return `finalizada (${l.parcelas}x)`;
}

// ---------- Componente ----------
function AppMvp() {
  const [estado, setEstado] = useState<Estado>(estadoInicial);
  const [hidratado, setHidratado] = useState(false);

  // Estados para Controle de Edição de Lançamentos
  const [idEditando, setIdEditando] = useState<string | null>(null);
  const [editDescricao, setEditDescricao] = useState("");
  const [editValor, setEditValor] = useState<number>(0);
  const [editTipo, setEditTipo] = useState<TipoLanc>("debito");
  const [editCardId, setEditCardId] = useState("");
  const [editParcelas, setEditParcelas] = useState(2);
  const [editParcelaAtual, setEditParcelaAtual] = useState(2);
  const [editEmAndamento, setEditEmAndamento] = useState(false);
  const [editData, setEditData] = useState("");
  const [editTerceiro, setEditTerceiro] = useState(false);
  const [editTerceiroNome, setEditTerceiroNome] = useState("");

  // MIGRADO AUTOMÁTICO EM SEGUNDO PLANO: Corrige dados legados sem IDs que travavam a edição
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        
        // Garante que cada lançamento, fixa ou cartão possua estritamente um ID único e válido
        const lancamentosMapeados = (parsed.lancamentos || []).map((l: any) => ({
          ...l,
          id: l.id || uid(),
        }));
        const fixasMapeadas = (parsed.fixas || []).map((f: any) => ({
          ...f,
          id: f.id || uid(),
        }));
        const cardsMapeados = (parsed.cards || []).map((c: any) => ({
          ...c,
          id: c.id || uid(),
        }));

        setEstado({
          ...estadoInicial,
          ...parsed,
          lancamentos: lancamentosMapeados,
          fixas: fixasMapeadas,
          cards: cardsMapeados,
        });
      }
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
    const proxPagamentoPrincipal =
      estado.modoSalario === "dia_util"
        ? proximoDiaUtilSalario(estado.diaUtilSalario, hoje)
        : proximaData(estado.diaSalario, hoje);

    const temAdiantamento = (estado.adiantamento || 0) > 0;
    const proxAdiantamento = temAdiantamento
      ? proximaData(estado.diaAdiantamento || 15, hoje)
      : null;

    const proxSalario = proxAdiantamento && proxAdiantamento < proxPagamentoPrincipal
      ? proxAdiantamento
      : proxPagamentoPrincipal;

    const diasAte = diasEntre(hoje, proxSalario);

    // CORREÇÃO DE LÓGICA: Contas que vencem estritamente ANTES da nova renda entrar (venc < proxSalario)
    const fixasFuturas = estado.fixas.reduce((s, f) => {
      const venc = proximaData(f.diaVencimento, hoje);
      return venc < proxSalario ? s + f.valor : s;
    }, 0);

    const debitoCiclo = estado.lancamentos
      .filter((l) => l.tipo === "debito" && !l.terceiro)
      .filter((l) => {
        const d = new Date(l.data);
        return diasEntre(d, hoje) <= 30 && d <= hoje;
      })
      .reduce((s, l) => s + l.valor, 0);

    const faturas = estado.cards.reduce(
      (s, c) => s + calcularFatura(c, estado.lancamentos, proximaData(c.vencimento, hoje), false),
      0,
    );

    const gastosTerceiros = estado.lancamentos
      .filter((l) => l.terceiro)
      .reduce((s, l) => s + l.valor / (l.parcelas || 1), 0);

    const rendaCicloAtivo = temAdiantamento && proxSalario === proxPagamentoPrincipal
      ? (estado.adiantamento || 0)
      : estado.salario + (estado.ticketTransporte || 0);

    const disponivelCiclo = Math.max(
      0,
      rendaCicloAtivo - fixasFuturas - debitoCiclo - faturas,
    );
    const porDia = disponivelCiclo / diasAte;

    const rendaMensalTotal = estado.salario + (estado.ticketTransporte || 0) + (estado.adiantamento || 0);

    // --- CÁLCULO DA PROJEÇÃO DO PRÓXIMO CICLO (A ESPIADA) ---
    const temProximoCiclo = temAdiantamento;
    
    const fimProximoCiclo = (() => {
      if (!temProximoCiclo) return proxSalario;
      if (proxSalario === proxAdiantamento) {
        return proxPagamentoPrincipal;
      } else {
        return proximaData(estado.diaAdiantamento || 15, proxPagamentoPrincipal);
      }
    })();

    const diasProximoCiclo = temProximoCiclo ? diasEntre(proxSalario, fimProximoCiclo) : 1;

    const rendaProximoCiclo = temProximoCiclo
      ? (proxSalario === proxAdiantamento
          ? (estado.adiantamento || 0)
          : estado.salario + (estado.ticketTransporte || 0))
      : rendaCicloAtivo;

    // CORREÇÃO DE LÓGICA: Contas do próximo ciclo de forma rigorosa (venc >= proxSalario && venc < fimProximoCiclo)
    const fixasProximoCiclo = estado.fixas.reduce((s, f) => {
      if (!temProximoCiclo) return 0;
      const venc = proximaData(f.diaVencimento, proxSalario);
      return venc >= proxSalario && venc < fimProximoCiclo ? s + f.valor : s;
    }, 0);

    const faturasProximoCiclo = estado.cards.reduce(
      (s, c) => s + calcularFatura(c, estado.lancamentos, proximaData(c.vencimento, proxSalario), false),
      0,
    );

    const disponivelProximoCiclo = Math.max(0, rendaProximoCiclo - fixasProximoCiclo - faturasProximoCiclo);
    const porDiaProximoCiclo = disponivelProximoCiclo / diasProximoCiclo;

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
      temProximoCiclo,
      fimProximoCiclo,
      diasProximoCiclo,
      disponivelProximoCiclo,
      porDiaProximoCiclo,
    };
  }, [estado, hoje]);

  // Função para Inicializar o Editor Inline de um Lançamento
  const iniciarEdicao = (l: Lancamento) => {
    setIdEditando(l.id);
    setEditDescricao(l.descricao);
    setEditValor(l.valor);
    setEditTipo(l.tipo);
    setEditCardId(l.cardId || "");
    setEditParcelas(l.parcelas || 2);
    setEditParcelaAtual(l.parcelaAtual || 2);
    setEditEmAndamento(!!l.emAndamento);
    setEditData(l.data);
    setEditTerceiro(!!l.terceiro);
    setEditTerceiroNome(l.terceiroNome || "");
  };

  // Função para Salvar a Edição Inline de um Lançamento
  const salvarEdicao = () => {
    setEstado((s) => ({
      ...s,
      lancamentos: s.lancamentos.map((l) =>
        l.id === idEditando
          ? {
              ...l,
              descricao: editDescricao,
              valor: editValor,
              tipo: editTipo,
              cardId: (editTipo === "credito_avista" || editTipo === "credito_parcelado") ? (editCardId || undefined) : undefined,
              parcelas: editTipo === "credito_parcelado" ? editParcelas : undefined,
              parcelaAtual: (editTipo === "credito_parcelado" && editEmAndamento) ? editParcelaAtual : undefined,
              emAndamento: (editTipo === "credito_parcelado" && editEmAndamento) ? true : undefined,
              data: editData,
              terceiro: editTerceiro || undefined,
              terceiroNome: editTerceiro && editTerceiroNome ? editTerceiroNome : undefined,
            }
          : l
      ),
    }));
    setIdEditando(null);
  };

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

        {/* ESPIADA NO PRÓXIMO CICLO (🔮 MODO SIMULAÇÃO) */}
        {calculo.temProximoCiclo && (
          <div className="mt-5 rounded-xl bg-accent/10 border border-accent/25 p-4 text-xs sm:text-sm text-accent-foreground flex items-start gap-3">
            <span className="text-lg">🔮</span>
            <div>
              <span className="font-semibold block sm:inline">Espiada no amanhã:</span> A partir de{" "}
              <strong>{calculo.proxSalario.toLocaleString("pt-BR", { day: "2-digit", month: "short" })}</strong>,
              sua projeção diária será de <strong>{brl(calculo.porDiaProximoCiclo)} por dia</strong> até{" "}
              {calculo.fimProximoCiclo.toLocaleString("pt-BR", { day: "2-digit", month: "short" })}{" "}
              ({calculo.diasProximoCiclo} dias · {brl(calculo.disponivelProximoCiclo)} livres após contas fixas e faturas previstas).
            </div>
          </div>
        )}

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
              type="text"
              value={formatarMoedaInput(estado.salario)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setEstado((s) => ({ ...s, salario: Number(digits) / 100 }));
              }}
              className={inputCls}
            />
          </Field>
          <Field label="Ticket Transporte / VT (R$)">
            <input
              type="text"
              value={formatarMoedaInput(estado.ticketTransporte)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setEstado((s) => ({ ...s, ticketTransporte: Number(digits) / 100 }));
              }}
              className={inputCls}
            />
          </Field>
          <Field label="Adiantamento / Vale / Quinzena (R$)">
            <input
              type="text"
              value={formatarMoedaInput(estado.adiantamento)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setEstado((s) => ({ ...s, adiantamento: Number(digits) / 100 }));
              }}
              className={inputCls}
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
            const vencCorrente = proximaData(c.vencimento, hoje);
            const fat = calcularFatura(c, estado.lancamentos, vencCorrente, false);
            const total = calcularFatura(c, estado.lancamentos, vencCorrente, true);
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

      {/* LANÇAMENTOS COM EDIÇÃO INLINE */}
      <Bloco titulo="4. Lançamentos">
        {[...estado.lancamentos].length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {[...estado.lancamentos]
              .sort((a, b) => (a.data < b.data ? 1 : -1))
              .map((l) => {
                const c = estado.cards.find((x) => x.id === l.cardId);
                const labelParcelamento = obterLabelParcela(l, c, hoje);
                const tipoLabel =
                  l.tipo === "debito"
                    ? "débito"
                    : l.tipo === "credito_avista"
                      ? `${c?.nome ?? "cartão"} · à vista`
                      : `${c?.nome ?? "cartão"} · ${labelParcelamento}`;

                // MODO EDIÇÃO INLINE
                if (idEditando === l.id) {
                  const ehCredito = editTipo === "credito_avista" || editTipo === "credito_parcelado";
                  const ehParcelado = editTipo === "credito_parcelado";

                  return (
                    <li key={l.id} className="py-4 space-y-3 bg-muted/30 p-4 rounded-lg my-2 border border-border/50">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Descrição">
                          <input
                            value={editDescricao}
                            onChange={(e) => setEditDescricao(e.target.value)}
                            className={inputCls}
                          />
                        </Field>
                        <Field label={ehParcelado && editEmAndamento ? "Valor da Parcela" : "Valor"}>
                          <input
                            type="text"
                            value={formatarMoedaInput(editValor)}
                            onChange={(e) => {
                              const digits = e.target.value.replace(/\D/g, "");
                              setEditValor(Number(digits) / 100);
                            }}
                            className={inputCls}
                          />
                        </Field>
                        <Field label="Tipo">
                          <select
                            value={editTipo}
                            onChange={(e) => setEditTipo(e.target.value as TipoLanc)}
                            className={inputCls}
                          >
                            <option value="debito">Débito</option>
                            <option value="credito_avista">Crédito à vista</option>
                            <option value="credito_parcelado">Crédito parcelado</option>
                          </select>
                        </Field>
                        <Field label="Data">
                          <input
                            type="date"
                            value={editData}
                            onChange={(e) => setEditData(e.target.value)}
                            className={inputCls}
                          />
                        </Field>

                        {ehCredito && (
                          <Field label="Cartão">
                            <select
                              value={editCardId}
                              onChange={(e) => setEditCardId(e.target.value)}
                              className={inputCls}
                            >
                              <option value="">Selecione…</option>
                              {estado.cards.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nome}
                                </option>
                              ))}
                            </select>
                          </Field>
                        )}

                        {ehParcelado && (
                          <Field label="Total de Parcelas">
                            <input
                              type="number"
                              min={2}
                              value={editParcelas}
                              onChange={(e) => setEditParcelas(Number(e.target.value) || 2)}
                              className={inputCls}
                            />
                          </Field>
                        )}

                        {ehParcelado && (
                          <div className="flex items-center gap-2 pt-6">
                            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editEmAndamento}
                                onChange={(e) => setEditEmAndamento(e.target.checked)}
                                className="h-4 w-4"
                              />
                              <span>Em andamento?</span>
                            </label>
                          </div>
                        )}

                        {ehParcelado && editEmAndamento && (
                          <Field label="Qual a Parcela Atual?">
                            <input
                              type="number"
                              min={1}
                              max={editParcelas}
                              value={editParcelaAtual}
                              onChange={(e) => setEditParcelaAtual(Number(e.target.value) || 1)}
                              className={inputCls}
                            />
                          </Field>
                        )}

                        <div className={ehParcelado ? "sm:col-span-2 lg:col-span-4" : "lg:col-span-4"}>
                          <Field label="Gasto de terceiro?">
                            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editTerceiro}
                                onChange={(e) => setEditTerceiro(e.target.checked)}
                                className="h-4 w-4"
                              />
                              <span>Não é meu</span>
                            </label>
                          </Field>
                        </div>

                        {editTerceiro && (
                          <div className="lg:col-span-4">
                            <Field label="Nome de quem gastou">
                              <input
                                value={editTerceiroNome}
                                onChange={(e) => setEditTerceiroNome(e.target.value)}
                                className={inputCls}
                              />
                            </Field>
                          </div>
                        )}
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setIdEditando(null)}
                          className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={salvarEdicao}
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer"
                        >
                          Salvar Alterações
                        </button>
                      </div>
                    </li>
                  );
                }

                // MODO EXIBIÇÃO NORMAL
                return (
                  <li key={l.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="flex-1 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-foreground font-medium">
                          {l.descricao}
                          {l.terceiro && (
                            <span className="ml-2 rounded bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent font-semibold">
                              terceiro{l.terceiroNome ? ` · ${l.terceiroNome}` : ""}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(l.data).toLocaleDateString("pt-BR")} · {tipoLabel}
                        </p>
                      </div>
                      <p className={`text-foreground font-semibold ${l.terceiro ? "opacity-60 font-normal" : ""}`}>
                        {brl(l.valor)}
                      </p>
                    </div>
                    <div className="flex gap-2.5">
                      <button
                        onClick={() => iniciarEdicao(l)}
                        className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer"
                        aria-label="Editar"
                      >
                        editar
                      </button>
                      <button
                        onClick={() =>
                          setEstado((s) => ({
                            ...s,
                            lancamentos: s.lancamentos.filter((x) => x.id !== l.id),
                          }))
                        }
                        className="text-xs text-muted-foreground hover:text-destructive underline cursor-pointer"
                        aria-label="Remover"
                      >
                        remover
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
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
          className="text-destructive hover:underline cursor-pointer"
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
            className="text-xs text-muted-foreground hover:text-destructive underline cursor-pointer"
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
  const [valor, setValor] = useState<number>(0);
  const [dia, setDia] = useState("10");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!nome || !valor) return;
        onAdd({ nome, valor, diaVencimento: Number(dia) });
        setNome("");
        setValor(0);
      }}
      className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_120px_auto]"
    >
      <input placeholder="Ex.: Aluguel" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
      <input
        placeholder="Valor"
        type="text"
        value={formatarMoedaInput(valor)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          setValor(Number(digits) / 100);
        }}
        className={inputCls}
      />
      <input placeholder="Dia" type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} className={inputCls} />
      <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 cursor-pointer">
        Adicionar
      </button>
    </form>
  );
}

function FormCard({ onAdd }: { onAdd: (c: Omit<Card, "id">) => void }) {
  const [nome, setNome] = useState("");
  const [limite, setLimite] = useState<number>(0);
  const [fech, setFech] = useState("25");
  const [venc, setVenc] = useState("5");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!nome) return;
        onAdd({
          nome,
          limite: limite || 0,
          fechamento: Number(fech),
          vencimento: Number(venc),
        });
        setNome("");
        setLimite(0);
      }}
      className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_140px_120px_120px_auto]"
    >
      <Field label="Nome do cartão">
        <input placeholder="Ex.: Nubank" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Limite (R$)">
        <input
          type="text"
          value={formatarMoedaInput(limite)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setLimite(Number(digits) / 100);
          }}
          className={inputCls}
        />
      </Field>
      <Field label="Dia do fechamento">
        <input type="number" min={1} max={31} value={fech} onChange={(e) => setFech(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Dia do vencimento">
        <input type="number" min={1} max={31} value={venc} onChange={(e) => setVenc(e.target.value)} className={inputCls} />
      </Field>
      <div className="flex items-end">
        <button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 cursor-pointer">
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
  const [valor, setValor] = useState<number>(0);
  const [tipo, setTipo] = useState<TipoLanc>("debito");
  const [cardId, setCardId] = useState<string>("");
  const [parcelas, setParcelas] = useState("2");
  const [data, setData] = useState(hoje);
  const [terceiro, setTerceiro] = useState(false);
  const [terceiroNome, setTerceiroNome] = useState("");
  
  const [emAndamento, setEmAndamento] = useState(false);
  const [parcelaAtual, setParcelaAtual] = useState("2");

  const ehCredito = tipo === "credito_avista" || tipo === "credito_parcelado";
  const ehParcelado = tipo === "credito_parcelado";

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
          valor,
          data,
          tipo,
          cardId: ehCredito ? cardId : undefined,
          parcelas: ehParcelado ? Number(parcelas) : undefined,
          parcelaAtual: ehParcelado && emAndamento ? Number(parcelaAtual) : undefined,
          emAndamento: ehParcelado && emAndamento ? true : undefined,
          terceiro: terceiro || undefined,
          terceiroNome: terceiro && terceiroNome ? terceiroNome : undefined,
        });
        setDescricao("");
        setValor(0);
        setTerceiro(false);
        setTerceiroNome("");
        setEmAndamento(false);
        setParcelaAtual("2");
      }}
      className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Field label="Descrição">
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputCls} placeholder="Ex.: Mercado" />
      </Field>
      <Field label={ehParcelado && emAndamento ? "Valor da Parcela (R$)" : "Valor (R$)"}>
        <input
          type="text"
          value={formatarMoedaInput(valor)}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setValor(Number(digits) / 100);
          }}
          className={inputCls}
        />
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
      {ehParcelado && (
        <Field label="Total de Parcelas">
          <input type="number" min={2} value={parcelas} onChange={(e) => setParcelas(e.target.value)} className={inputCls} />
        </Field>
      )}

      {ehParcelado && (
        <div className="flex items-center gap-2 pt-6">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={emAndamento}
              onChange={(e) => setEmAndamento(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Já está em andamento (fatura anterior)?</span>
          </label>
        </div>
      )}

      {ehParcelado && emAndamento && (
        <Field label="Qual a Parcela Atual?">
          <input 
            type="number" 
            min={1} 
            max={Number(parcelas) || 12} 
            value={parcelaAtual} 
            onChange={(e) => setParcelaAtual(e.target.value)} 
            className={inputCls} 
            placeholder="Ex: se é 2/3, digite 2"
          />
        </Field>
      )}

      <div className={ehParcelado ? "sm:col-span-2 lg:col-span-4" : "lg:col-span-4"}>
        <Field label="Gasto de terceiro?">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={terceiro}
              onChange={(e) => setTerceiro(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Não é meu — não contar no cálculo</span>
          </label>
        </Field>
      </div>
      {terceiro && (
        <div className="lg:col-span-4">
          <Field label="Nome de quem gastou (opcional)">
            <input value={terceiroNome} onChange={(e) => setTerceiroNome(e.target.value)} className={inputCls} placeholder="Ex.: Mãe" />
          </Field>
        </div>
      )}

      <div className="lg:col-span-4 mt-2">
        <button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 cursor-pointer">
          Adicionar lançamento
        </button>
      </div>
    </form>
  );
}
