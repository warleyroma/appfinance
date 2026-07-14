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
  parcelas?: number; 
  parcelaAtual?: number; 
  emAndamento?: boolean; 
  terceiro?: boolean; 
  terceiroNome?: string;
};

type ModoSalario = "dia_fixo" | "dia_util";

type Estado = {
  salario: number;
  ticketTransporte?: number;
  adiantamento?: number;
  diaAdiantamento?: number;
  modoSalario: ModoSalario;
  diaSalario: number; 
  diaUtilSalario: number; 
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

function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return new Date();
  }
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

const uid = () => Math.random().toString(36).slice(2, 10);

function ehDiaUtil(d: Date) {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

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

function obterUltimaData(diaAlvo: number, base: Date) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const ano = d.getFullYear();
  const mes = d.getMonth();
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const dia = Math.min(diaAlvo, ultimoDia);
  let alvo = new Date(ano, mes, dia);
  if (alvo > d) {
    const ultimoAnterior = new Date(ano, mes, 0).getDate();
    alvo = new Date(ano, mes - 1, Math.min(diaAlvo, ultimoAnterior));
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

function calcularFatura(card: Card, lancs: Lancamento[], vencRef: Date, considerarTerceiros: boolean) {
  const fechRef = obterFechamentoParaVencimento(vencRef, card.fechamento, card.vencimento);
  
  return lancs
    .filter((l) => l.cardId === card.id && (considerarTerceiros || !l.terceiro))
    .reduce((total, l) => {
      const compDate = parseLocalDate(l.data);

      if (l.tipo === "credito_avista") {
        const fechAnterior = new Date(fechRef);
        fechAnterior.setMonth(fechAnterior.getMonth() - 1);
        if (compDate > fechAnterior && compDate <= fechRef) return total + l.valor;
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
          if (parcelaAtualNoCiclo > 0 && parcelaAtualNoCiclo <= (l.parcelas || 1)) return total + l.valor;
        } else {
          if (diffMeses >= 0 && diffMeses < (l.parcelas || 1)) return total + (l.valor / (l.parcelas || 1));
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
  const compDate = parseLocalDate(l.data);
  const fechNoMes = new Date(compDate.getFullYear(), compDate.getMonth(), Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 1, 0).getDate()));
  let fechCompra = fechNoMes;
  if (compDate > fechNoMes) {
    fechCompra = new Date(compDate.getFullYear(), compDate.getMonth() + 1, Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 2, 0).getDate()));
  }
  const diffMeses = (fechRef.getFullYear() - fechCompra.getFullYear()) * 12 + (fechRef.getMonth() - fechCompra.getMonth());
  const numParcela = l.emAndamento ? (l.parcelaAtual || 1) + diffMeses : diffMeses + 1;
  if (numParcela > 0 && numParcela <= (l.parcelas || 1)) return `parcela ${numParcela}/${l.parcelas}`;
  return `finalizada (${l.parcelas}x)`;
}

function AppMvp() {
  const [estado, setEstado] = useState<Estado>(estadoInicial);
  const [hidratado, setHidratado] = useState(false);

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

  const [idEditandoFixa, setIdEditandoFixa] = useState<string | null>(null);
  const [editFixaNome, setEditFixaNome] = useState("");
  const [editFixaValor, setEditFixaValor] = useState<number>(0);
  const [editFixaDia, setEditFixaDia] = useState(10);

  const [idEditandoCard, setIdEditandoCard] = useState<string | null>(null);
  const [editCardNome, setEditCardNome] = useState("");
  const [editCardLimite, setEditCardLimite] = useState<number>(0);
  const [editCardFech, setEditCardFech] = useState(25);
  const [editCardVenc, setEditCardVenc] = useState(5);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const lancamentosMapeados = (parsed.lancamentos || []).map((l: any) => ({ ...l, id: l.id || uid() }));
        const fixasMapeadas = (parsed.fixas || []).map((f: any) => ({ ...f, id: f.id || uid() }));
        const cardsMapeados = (parsed.cards || []).map((c: any) => ({ ...c, id: c.id || uid() }));
        setEstado({ ...estadoInicial, ...parsed, lancamentos: lancamentosMapeados, fixas: fixasMapeadas, cards: cardsMapeados });
      }
    } catch { }
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
    const proxPagamentoPrincipal = estado.modoSalario === "dia_util" ? proximoDiaUtilSalario(estado.diaUtilSalario, hoje) : proximaData(estado.diaSalario, hoje);
    const temAdiantamento = (estado.adiantamento || 0) > 0;
    const proxAdiantamento = temAdiantamento ? proximaData(estado.diaAdiantamento || 15, hoje) : null;
    const proxSalario = proxAdiantamento && proxAdiantamento < proxPagamentoPrincipal ? proxAdiantamento : proxPagamentoPrincipal;
    const diasAte = diasEntre(hoje, proxSalario);

    const ultimoPagamentoPrincipal = (() => {
      if (estado.modoSalario === "dia_util") {
        const dPrincipalNoMes = nthDiaUtil(hoje.getFullYear(), hoje.getMonth(), estado.diaUtilSalario);
        if (dPrincipalNoMes > hoje) {
          const anoAnterior = hoje.getMonth() === 0 ? hoje.getFullYear() - 1 : hoje.getFullYear();
          const mesAnterior = hoje.getMonth() === 0 ? 11 : hoje.getMonth() - 1;
          return nthDiaUtil(anoAnterior, mesAnterior, estado.diaUtilSalario);
        }
        return dPrincipalNoMes;
      } else return obterUltimaData(estado.diaSalario, hoje);
    })();
    const ultimoAdiantamento = temAdiantamento ? obterUltimaData(estado.diaAdiantamento || 15, hoje) : null;
    const inicioCiclo = temAdiantamento && ultimoAdiantamento && ultimoAdiantamento > ultimoPagamentoPrincipal ? ultimoAdiantamento : ultimoPagamentoPrincipal;

    const fixasFuturas = estado.fixas.reduce((s, f) => {
      const venc = proximaData(f.diaVencimento, hoje);
      return venc < proxSalario ? s + f.valor : s;
    }, 0);

    const debitoCiclo = estado.lancamentos
      .filter((l) => l.tipo === "debito" && !l.terceiro)
      .filter((l) => {
        const d = parseLocalDate(l.data);
        return d >= inicioCiclo && d <= hoje;
      })
      .reduce((s, l) => s + l.valor, 0);

    const faturas = estado.cards.reduce((s, c) => {
      const vencRef = proximaData(c.vencimento, hoje);
      return vencRef < proxSalario ? s + calcularFatura(c, estado.lancamentos, vencRef, false) : s;
    }, 0);

    const rendaCicloAtivo = temAdiantamento && proxSalario === proxPagamentoPrincipal ? (estado.adiantamento || 0) : estado.salario + (estado.ticketTransporte || 0);
    const disponivelCiclo = Math.max(0, rendaCicloAtivo - fixasFuturas - debitoCiclo - faturas);
    const porDia = disponivelCiclo / diasAte;

    const fimProximoCiclo = !temAdiantamento ? proxSalario : (proxSalario === proxAdiantamento ? proxPagamentoPrincipal : proximaData(estado.diaAdiantamento || 15, proxPagamentoPrincipal));
    const diasProximoCiclo = temAdiantamento ? diasEntre(proxSalario, fimProximoCiclo) : 1;
    const rendaProximoCiclo = temAdiantamento ? (proxSalario === proxAdiantamento ? (estado.adiantamento || 0) : estado.salario + (estado.ticketTransporte || 0)) : rendaCicloAtivo;
    const fixasProximoCiclo = estado.fixas.reduce((s, f) => {
      if (!temAdiantamento) return 0;
      const venc = proximaData(f.diaVencimento, proxSalario);
      return venc >= proxSalario && venc < fimProximoCiclo ? s + f.valor : s;
    }, 0);
    const faturasProximoCiclo = estado.cards.reduce((s, c) => {
      if (!temAdiantamento) return 0;
      const vencRef = proximaData(c.vencimento, proxSalario);
      return (vencRef >= proxSalario && vencRef < fimProximoCiclo) ? s + calcularFatura(c, estado.lancamentos, vencRef, false) : s;
    }, 0);

    const disponivelProximoCiclo = Math.max(0, rendaProximoCiclo - fixasProximoCiclo - faturasProximoCiclo);
    const porDiaProximoCiclo = disponivelProximoCiclo / diasProximoCiclo;

    return { 
      proxSalario, diasAte, fixasFuturas, debitoCiclo, faturas, 
      disponivelCiclo, porDia, rendaTotal: rendaCicloAtivo, 
      rendaMensalTotal: estado.salario + (estado.ticketTransporte || 0) + (estado.adiantamento || 0),
      temProximoCiclo: temAdiantamento, fimProximoCiclo, diasProximoCiclo, disponivelProximoCiclo, porDiaProximoCiclo 
    };
  }, [estado, hoje]);

  const iniciarEdicaoFixa = (f: Fixa) => { setIdEditandoFixa(f.id); setEditFixaNome(f.nome); setEditFixaValor(f.valor); setEditFixaDia(f.diaVencimento); };
  const salvarEdicaoFixa = () => { setEstado((s) => ({ ...s, fixas: s.fixas.map((f) => f.id === idEditandoFixa ? { ...f, nome: editFixaNome, valor: editFixaValor, diaVencimento: editFixaDia } : f) })); setIdEditandoFixa(null); };

  const iniciarEdicaoCard = (c: Card) => { setIdEditandoCard(c.id); setEditCardNome(c.nome); setEditCardLimite(c.limite); setEditCardFech(c.fechamento); setEditCardVenc(c.vencimento); };
  const salvarEdicaoCard = () => { setEstado((s) => ({ ...s, cards: s.cards.map((c) => c.id === idEditandoCard ? { ...c, nome: editCardNome, limite: editCardLimite, fechamento: editCardFech, vencimento: editCardVenc } : c) })); setIdEditandoCard(null); };

  const iniciarEdicao = (l: Lancamento) => { setIdEditando(l.id); setEditDescricao(l.descricao); setEditValor(l.valor); setEditTipo(l.tipo); setEditCardId(l.cardId || ""); setEditParcelas(l.parcelas || 2); setEditParcelaAtual(l.parcelaAtual || 2); setEditEmAndamento(!!l.emAndamento); setEditData(l.data); setEditTerceiro(!!l.terceiro); setEditTerceiroNome(l.terceiroNome || ""); };
  const salvarEdicao = () => { setEstado((s) => ({ ...s, lancamentos: s.lancamentos.map((l) => l.id === idEditando ? { ...l, descricao: editDescricao, valor: editValor, tipo: editTipo, cardId: (editTipo.includes("credito")) ? (editCardId || undefined) : undefined, parcelas: editTipo === "credito_parcelado" ? editParcelas : undefined, parcelaAtual: (editTipo === "credito_parcelado" && editEmAndamento) ? editParcelaAtual : undefined, emAndamento: (editTipo === "credito_parcelado" && editEmAndamento) ? true : undefined, data: editData, terceiro: editTerceiro || undefined, terceiroNome: editTerceiro && editTerceiroNome ? editTerceiroNome : undefined } : l) })); setIdEditando(null); };

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Voltar ao roadmap</Link>
      <header className="mt-6">
        <p className="text-sm uppercase tracking-[0.2em] text-accent">MVP · Protótipo funcional</p>
        <h1 className="mt-3 font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl">Quanto você pode gastar <em className="text-accent">hoje</em>?</h1>
      </header>

      <section className="mt-10 rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Disponível por dia até {calculo.proxSalario.toLocaleString("pt-BR", { day: "2-digit", month: "short" })}</p>
        <p className="mt-2 font-serif text-6xl text-foreground">{brl(calculo.porDia)}</p>
        <p className="mt-2 text-sm text-muted-foreground">{calculo.diasAte} {calculo.diasAte === 1 ? "dia restante" : "dias restantes"} · total {brl(calculo.disponivelCiclo)}</p>
        {calculo.temProximoCiclo && (
          <div className="mt-5 rounded-xl bg-accent/10 border border-accent/25 p-4 text-xs sm:text-sm text-accent-foreground flex items-start gap-3">
            <span className="text-lg">🔮</span>
            <div><span className="font-semibold">Espiada no amanhã:</span> A partir de <strong>{calculo.proxSalario.toLocaleString("pt-BR", { day: "2-digit", month: "short" })}</strong>, sua projeção será de <strong>{brl(calculo.porDiaProximoCiclo)} p/ dia</strong>.</div>
          </div>
        )}
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <Metric label="Renda do Ciclo" valor={calculo.rendaTotal} />
          <Metric label="Contas fixas" valor={calculo.fixasFuturas} negative />
          <Metric label="Débito no ciclo" valor={calculo.debitoCiclo} negative />
          <Metric label="Faturas abertas" valor={calculo.faturas} negative />
        </div>
      </section>

      <Bloco titulo="1. Renda e ciclo">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Salário líquido restante">
            <input type="text" value={formatarMoedaInput(estado.salario)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEstado((s) => ({ ...s, salario: Number(digits) / 100 })); }} className={inputCls} />
          </Field>
          <Field label="Ticket Transporte / VT">
            <input type="text" value={formatarMoedaInput(estado.ticketTransporte)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEstado((s) => ({ ...s, ticketTransporte: Number(digits) / 100 })); }} className={inputCls} />
          </Field>
          <Field label="Adiantamento / Quinzena">
            <input type="text" value={formatarMoedaInput(estado.adiantamento)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEstado((s) => ({ ...s, adiantamento: Number(digits) / 100 })); }} className={inputCls} />
          </Field>
          <Field label="Dia do adiantamento">
            <input type="number" min={1} max={31} value={estado.diaAdiantamento} onChange={(e) => setEstado((s) => ({ ...s, diaAdiantamento: Number(e.target.value) || 15 }))} className={inputCls} />
          </Field>
          <Field label="Recebimento do salário">
            <select value={estado.modoSalario} onChange={(e) => setEstado((s) => ({ ...s, modoSalario: e.target.value as ModoSalario }))} className={inputCls}>
              <option value="dia_fixo">Dia fixo do mês</option>
              <option value="dia_util">Dia útil</option>
            </select>
          </Field>
          <Field label={estado.modoSalario === "dia_fixo" ? "Dia do recebimento" : "Qual dia útil?"}>
            <input type="number" value={estado.modoSalario === "dia_fixo" ? estado.diaSalario : estado.diaUtilSalario} onChange={(e) => setEstado((s) => ({ ...s, [estado.modoSalario === "dia_fixo" ? "diaSalario" : "diaUtilSalario"]: Number(e.target.value) || 1 }))} className={inputCls} />
          </Field>
        </div>
      </Bloco>

      <Bloco titulo="2. Contas fixas">
        <ul className="divide-y divide-border">
          {estado.fixas.map((f) => idEditandoFixa === f.id ? (
            <li key={f.id} className="py-4 space-y-3 bg-muted/30 p-4 rounded-lg my-2 border border-border/50">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Nome"><input value={editFixaNome} onChange={(e) => setEditFixaNome(e.target.value)} className={inputCls} /></Field>
                <Field label="Valor"><input type="text" value={formatarMoedaInput(editFixaValor)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setEditFixaValor(Number(d) / 100); }} className={inputCls} /></Field>
                <Field label="Vencimento"><input type="number" value={editFixaDia} onChange={(e) => setEditFixaDia(Number(e.target.value) || 1)} className={inputCls} /></Field>
              </div>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setIdEditandoFixa(null)} className="text-xs p-2">Cancelar</button><button type="button" onClick={salvarEdicaoFixa} className="rounded bg-primary px-3 py-1 text-xs text-white">Salvar</button></div>
            </li>
          ) : (
            <li key={f.id} className="flex items-center justify-between py-3">
              <div className="flex-1 flex items-center justify-between gap-4"><div><p className="font-medium">{f.nome}</p><p className="text-xs text-muted-foreground">Dia {f.diaVencimento}</p></div><p className="font-semibold">{brl(f.valor)}</p></div>
              <div className="flex gap-2 ml-4"><button onClick={() => iniciarEdicaoFixa(f)} className="text-xs underline">editar</button><button onClick={() => setEstado(s => ({ ...s, fixas: s.fixas.filter(x => x.id !== f.id) }))} className="text-xs text-destructive underline">remover</button></div>
            </li>
          ))}
        </ul>
        <FormFixa onAdd={(f) => setEstado((s) => ({ ...s, fixas: [...s.fixas, { ...f, id: uid() }] }))} />
      </Bloco>

      {/* CARDS COM EDIÇÃO INLINE */}
      <Bloco titulo="3. Cartões de crédito">
        <ul className="divide-y divide-border">
          {estado.cards.map((c) => idEditandoCard === c.id ? (
            <li key={c.id} className="py-4 space-y-3 bg-muted/30 p-4 rounded-lg my-2 border border-border/50">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Nome"><input value={editCardNome} onChange={(e) => setEditCardNome(e.target.value)} className={inputCls} /></Field>
                <Field label="Limite"><input type="text" value={formatarMoedaInput(editCardLimite)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setEditCardLimite(Number(d) / 100); }} className={inputCls} /></Field>
                <Field label="Fecha"><input type="number" value={editCardFech} onChange={(e) => setEditCardFech(Number(e.target.value) || 1)} className={inputCls} /></Field>
                <Field label="Vence"><input type="number" value={editCardVenc} onChange={(e) => setEditCardVenc(Number(e.target.value) || 1)} className={inputCls} /></Field>
              </div>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setIdEditandoCard(null)} className="text-xs p-2">Cancelar</button><button type="button" onClick={salvarEdicaoCard} className="rounded bg-primary px-3 py-1 text-xs text-white">Salvar</button></div>
            </li>
          ) : (
            <li key={c.id} className="flex items-center justify-between py-3">
              <div className="flex-1 flex items-center justify-between gap-4"><div><p className="font-medium">{c.nome}</p><p className="text-xs text-muted-foreground">Fecha {c.fechamento} · Vence {c.vencimento}</p></div><p className="font-semibold">{brl(calcularFatura(c, estado.lancamentos, proximaData(c.vencimento, hoje), false))}</p></div>
              <div className="flex gap-2 ml-4"><button onClick={() => iniciarEdicaoCard(c)} className="text-xs underline">editar</button><button onClick={() => setEstado(s => ({ ...s, cards: s.cards.filter(x => x.id !== c.id) }))} className="text-xs text-destructive underline">remover</button></div>
            </li>
          ))}
        </ul>
        <FormCard onAdd={(c) => setEstado((s) => ({ ...s, cards: [...s.cards, { ...c, id: uid() }] }))} />
      </Bloco>

      {/* LANÇAMENTOS COM EDIÇÃO INLINE */}
      <Bloco titulo="4. Lançamentos">
        <ul className="divide-y divide-border">
          {/* CORREÇÃO CRÍTICA: Impedir a mutação direta do estado no render criando uma cópia antes do sort */}
          {[...estado.lancamentos].sort((a, b) => a.data < b.data ? 1 : -1).map((l) => idEditando === l.id ? (
            <li key={l.id} className="py-4 space-y-3 bg-muted/30 p-4 rounded-lg my-2 border border-border/50">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Descrição"><input value={editDescricao} onChange={(e) => setEditDescricao(e.target.value)} className={inputCls} /></Field>
                <Field label="Valor"><input type="text" value={formatarMoedaInput(editValor)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setEditValor(Number(d) / 100); }} className={inputCls} /></Field>
                <Field label="Tipo"><select value={editTipo} onChange={(e) => setEditTipo(e.target.value as TipoLanc)} className={inputCls}><option value="debito">Débito</option><option value="credito_avista">À vista</option><option value="credito_parcelado">Parcelado</option></select></Field>
                <Field label="Data"><input type="date" value={editData} onChange={(e) => setEditData(e.target.value)} className={inputCls} /></Field>
              </div>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setIdEditando(null)} className="text-xs p-2">Cancelar</button><button type="button" onClick={salvarEdicao} className="rounded bg-primary px-3 py-1 text-xs text-white">Salvar</button></div>
            </li>
          ) : (
            <li key={l.id} className="flex items-center justify-between py-3">
              <div className="flex-1 flex items-center justify-between gap-4"><div><p className="font-medium">{l.descricao}{l.terceiro && <span className="ml-2 text-[10px] bg-accent/10 px-1 uppercase tracking-wider text-accent font-semibold">terceiro</span>}</p><p className="text-xs text-muted-foreground">{parseLocalDate(l.data).toLocaleDateString("pt-BR")} · {l.tipo === "debito" ? "débito" : `${estado.cards.find(x => x.id === l.cardId)?.nome || "cartão"} · ${obterLabelParcela(l, estado.cards.find(x => x.id === l.cardId), hoje)}`}</p></div><p className="font-semibold">{brl(l.valor)}</p></div>
              <div className="flex gap-2 ml-4"><button onClick={() => iniciarEdicao(l)} className="text-xs underline cursor-pointer">editar</button><button onClick={() => setEstado(s => ({ ...s, lancamentos: s.lancamentos.filter(x => x.id !== l.id) }))} className="text-xs text-destructive underline cursor-pointer">remover</button></div>
            </li>
          ))}
        </ul>
        <FormLanc cards={estado.cards} onAdd={(l) => setEstado((s) => ({ ...s, lancamentos: [...s.lancamentos, { ...l, id: uid() }] }))} />
      </Bloco>

      <div className="mt-16 flex items-center justify-between border-t border-border pt-6 text-sm text-muted-foreground">
        <span>Protótipo local · sem backend</span>
        <button onClick={() => confirm("Zerar dados?") && setEstado(estadoInicial)} className="text-destructive hover:underline cursor-pointer">Zerar dados</button>
      </div>
    </main>
  );
}

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return (<label className="block"><span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>); }
function Metric({ label, valor, negative }: { label: string; valor: number; negative?: boolean }) { return (<div className="rounded-lg border border-border/70 bg-parchment/50 p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-1 font-serif text-2xl ${negative ? "text-foreground/80" : "text-foreground"}`}>{negative && valor > 0 ? "−" : ""}{brl(valor)}</p></div>); }
function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) { return (<section className="mt-12"><h2 className="font-serif text-2xl text-foreground">{titulo}</h2><div className="mt-4 rounded-xl border border-border bg-card p-6">{children}</div></section>); }

function FormFixa({ onAdd }: { onAdd: (f: Omit<Fixa, "id">) => void }) {
  const [nome, setNome] = useState(""); const [valor, setValor] = useState<number>(0); const [dia, setDia] = useState("10");
  return (<form onSubmit={(e) => { e.preventDefault(); if (!nome || !valor) return; onAdd({ nome, valor, diaVencimento: Number(dia) }); setNome(""); setValor(0); }} className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_120px_auto]"><input placeholder="Ex.: Aluguel" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} /><input type="text" value={formatarMoedaInput(valor)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setValor(Number(d) / 100); }} className={inputCls} /><input type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} className={inputCls} /><button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer">Adicionar</button></form>);
}

function FormCard({ onAdd }: { onAdd: (c: Omit<Card, "id">) => void }) {
  const [nome, setNome] = useState(""); const [limite, setLimite] = useState<number>(0); const [fech, setFech] = useState("25"); const [venc, setVenc] = useState("5");
  return (<form onSubmit={(e) => { e.preventDefault(); if (!nome) return; onAdd({ nome, limite: limite || 0, fechamento: Number(fech), vencimento: Number(venc) }); setNome(""); setLimite(0); }} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_140px_120px_120px_auto]"><Field label="Nome"><input placeholder="Ex.: Nubank" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} /></Field><Field label="Limite"><input type="text" value={formatarMoedaInput(limite)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setLimite(Number(d) / 100); }} className={inputCls} /></Field><Field label="Fecha"><input type="number" value={fech} onChange={(e) => setFech(e.target.value)} className={inputCls} /></Field><Field label="Vence"><input type="number" value={venc} onChange={(e) => setVenc(e.target.value)} className={inputCls} /></Field><div className="flex items-end"><button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer">Adicionar</button></div></form>);
}

function FormLanc({ cards, onAdd }: { cards: Card[]; onAdd: (l: Omit<Lancamento, "id">) => void }) {
  const [descricao, setDescricao] = useState(""); const [valor, setValor] = useState<number>(0); const [tipo, setTipo] = useState<TipoLanc>("debito"); const [cardId, setCardId] = useState(""); const [parcelas, setParcelas] = useState("2"); const [data, setData] = useState(new Date().toISOString().slice(0, 10)); const [terceiro, setTerceiro] = useState(false); const [emAndamento, setEmAndamento] = useState(false); const [parcelaAtual, setParcelaAtual] = useState("2");
  const ehCredito = tipo.includes("credito"); const ehParcelado = tipo === "credito_parcelado";
  return (<form onSubmit={(e) => { e.preventDefault(); if (!descricao || !valor) return; if (ehCredito && !cardId) return alert("Selecione um cartão"); onAdd({ descricao, valor, data, tipo, cardId: ehCredito ? cardId : undefined, parcelas: ehParcelado ? Number(parcelas) : undefined, parcelaAtual: (ehParcelado && emAndamento) ? Number(parcelaAtual) : undefined, emAndamento: (ehParcelado && emAndamento) ? true : undefined, terceiro: terceiro || undefined }); setDescricao(""); setValor(0); setTerceiro(false); setEmAndamento(false); }} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Descrição"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputCls} /></Field><Field label="Valor"><input type="text" value={formatarMoedaInput(valor)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setValor(Number(d) / 100); }} className={inputCls} /></Field><Field label="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as TipoLanc)} className={inputCls}><option value="debito">Débito</option><option value="credito_avista">À vista</option><option value="credito_parcelado">Parcelado</option></select></Field><Field label="Data"><input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} /></Field>{ehCredito && (<Field label="Cartão"><select value={cardId} onChange={(e) => setCardId(e.target.value)} className={inputCls}><option value="">Selecione…</option>{cards.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}</select></Field>)}{ehParcelado && (<Field label="Total Parcelas"><input type="number" value={parcelas} onChange={(e) => setParcelas(e.target.value)} className={inputCls} /></Field>)}{ehParcelado && (<div className="flex items-center gap-2 pt-6"><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={emAndamento} onChange={(e) => setEmAndamento(e.target.checked)} className="h-4 w-4" /><span>Em andamento?</span></label></div>)}{ehParcelado && emAndamento && (<Field label="Parcela Atual"><input type="number" value={parcelaAtual} onChange={(e) => setParcelaAtual(e.target.value)} className={inputCls} /></Field>)}<div className="lg:col-span-4"><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={terceiro} onChange={(e) => setTerceiro(e.target.checked)} className="h-4 w-4" /><span>Gasto de terceiro</span></label></div><div className="lg:col-span-4 mt-2"><button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer">Adicionar lançamento</button></div></form>);
}
