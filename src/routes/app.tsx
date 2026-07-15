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
  valorFaturaAtual?: number; // Dívida pendente informada no onboarding
  faturaPaga?: boolean;
};

type Fixa = { 
  id: string; 
  nome: string; 
  valor: number; 
  dataVencimento: string; // data exata ISO
  status: "pendente" | "paga" | "cancelada"; // Status explícito
};

type TipoLanc = "debito" | "credito_avista" | "credito_parcelado" | "estorno" | "credito_recorrente";

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
  dataRegistro?: string; // Data de inserção
  ativo?: boolean; // Controle de assinaturas
  terceiro?: boolean; 
  terceiroNome?: string;
};

// Tipo para as linhas cronológicas do fluxo de caixa
type FinanceEvent = {
  id: string;
  tipo: "saldo_inicial" | "salario" | "adiantamento" | "ticket" | "fixa" | "debito" | "estorno" | "fatura_cartao";
  descricao: string;
  data: Date;
  valor: number; // positivo para entrada, negativo para saída
  saldoAcumulado: number;
  origemId?: string;
};

type ModoSalario = "dia_fixo" | "dia_util";

type Estado = {
  onboardingCompleto: boolean;
  onboardingPasso: number;
  saldoInicial: number;
  ultimoSalarioJaCaiu: boolean;
  pagouContasAnteriores: boolean;
  temFaturaPendente: boolean;
  modoComecarHoje: boolean;

  salario: number;
  ticketTransporte?: number;
  temAdiantamento?: boolean;
  adiantamento?: number;
  dataUltimoSalario?: string;
  dataProximoSalario?: string;
  dataUltimoAdiantamento?: string;
  dataProximoAdiantamento?: string;
  fixas: Fixa[];
  cards: Card[];
  lancamentos: Lancamento[];
};

const STORAGE_KEY = "qpg.mvp.v3";

const obterDataPadrao = (dia: number, offsetMes: number) => {
  const d = new Date();
  d.setDate(dia);
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + offsetMes);
  return d.toISOString().slice(0, 10);
};

const estadoInicial: Estado = {
  onboardingCompleto: false,
  onboardingPasso: 1,
  saldoInicial: 0,
  ultimoSalarioJaCaiu: true,
  pagouContasAnteriores: true,
  temFaturaPendente: false,
  modoComecarHoje: true,

  salario: 0,
  ticketTransporte: 0,
  temAdiantamento: false,
  adiantamento: 0,
  dataUltimoSalario: obterDataPadrao(5, 0),
  dataProximoSalario: obterDataPadrao(5, 1),
  dataUltimoAdiantamento: obterDataPadrao(15, 0),
  dataProximoAdiantamento: obterDataPadrao(15, 1),
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

// Calcula o valor total devido em uma fatura específica de cartão
function calcularFatura(card: Card, lancs: Lancamento[], vencRef: Date, considerarTerceiros: boolean) {
  const fechRef = obterFechamentoParaVencimento(vencRef, card.fechamento, card.vencimento);
  const vencAnterior = new Date(vencRef);
  vencAnterior.setMonth(vencAnterior.getMonth() - 1);
  const fechAnterior = obterFechamentoParaVencimento(vencAnterior, card.fechamento, card.vencimento);

  return lancs
    .filter((l) => l.cardId === card.id && (considerarTerceiros || !l.terceiro))
    .reduce((total, l) => {
      const compDate = parseLocalDate(l.emAndamento ? (l.dataRegistro || l.data) : l.data);

      if (l.tipo === "credito_avista") {
        if (compDate > fechAnterior && compDate <= fechRef) return total + l.valor;
        return total;
      }

      if (l.tipo === "estorno") {
        if (compDate > fechAnterior && compDate <= fechRef) return total - l.valor;
        return total;
      }

      if (l.tipo === "credito_recorrente") {
        if (l.ativo === false) return total; 
        const fechNoMes = new Date(compDate.getFullYear(), compDate.getMonth(), Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 1, 0).getDate()));
        let fechCompra = fechNoMes;
        if (compDate > fechNoMes) {
          fechCompra = new Date(compDate.getFullYear(), compDate.getMonth() + 1, Math.min(card.fechamento, new Date(compDate.getFullYear(), compDate.getMonth() + 2, 0).getDate()));
        }
        const diffMeses = (fechRef.getFullYear() - fechCompra.getFullYear()) * 12 + (fechRef.getMonth() - fechCompra.getMonth());
        if (diffMeses >= 0) return total + l.valor;
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
  const compDate = parseLocalDate(l.emAndamento ? (l.dataRegistro || l.data) : l.data);
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

function obterProximoVencimentoExato(f: Fixa, hoje: Date): Date {
  let venc = parseLocalDate(f.dataVencimento || obterDataPadrao(10, 0));
  while (hoje >= venc) {
    venc = new Date(venc);
    venc.setMonth(venc.getMonth() + 1);
  }
  return venc;
}

// ============================================================================
// MOTOR ÚNICO DE CÁLCULO FINANCEIRO (FINANCIAL ENGINE)
// ============================================================================
function runFinancialEngine(estado: Estado, hoje: Date) {
  const events: FinanceEvent[] = [];

  // 1. EVENTO ZERO: Saldo Inicial no dia de hoje
  events.push({
    id: "saldo_zero",
    tipo: "saldo_inicial",
    descricao: "Saldo Inicial Disponível",
    data: new Date(hoje),
    valor: estado.saldoInicial,
    saldoAcumulado: estado.saldoInicial,
  });

  // 2. ENTRADAS - Salário e Adiantamento (Projetados em 60 dias)
  const dUltimoSalario = parseLocalDate(estado.dataUltimoSalario || obterDataPadrao(5, 0));
  let dProximoSalario = parseLocalDate(estado.dataProximoSalario || obterDataPadrao(5, 1));
  
  // Rolagem automática se a data prevista já passou
  while (hoje >= dProximoSalario) {
    dProximoSalario.setMonth(dProximoSalario.getMonth() + 1);
  }

  // Projetar os próximos 2 salários
  for (let m = 0; m < 2; m++) {
    const dataSal = new Date(dProximoSalario);
    dataSal.setMonth(dataSal.getMonth() + m);
    
    events.push({
      id: `salario_${m}`,
      tipo: "salario",
      descricao: "Recebimento de Salário",
      data: dataSal,
      valor: estado.salario,
      saldoAcumulado: 0,
    });

    if (estado.ticketTransporte && estado.ticketTransporte > 0) {
      events.push({
        id: `ticket_${m}`,
        tipo: "ticket",
        descricao: "Ticket Transporte (VT)",
        data: dataSal,
        valor: estado.ticketTransporte,
        saldoAcumulado: 0,
      });
    }
  }

  // Projetar os próximos 2 adiantamentos
  if (estado.temAdiantamento && estado.adiantamento && estado.adiantamento > 0) {
    let dProximoAdiantamento = parseLocalDate(estado.dataProximoAdiantamento || obterDataPadrao(15, 1));
    while (hoje >= dProximoAdiantamento) {
      dProximoAdiantamento.setMonth(dProximoAdiantamento.getMonth() + 1);
    }

    for (let m = 0; m < 2; m++) {
      const dataAd = new Date(dProximoAdiantamento);
      dataAd.setMonth(dataAd.getMonth() + m);
      
      events.push({
        id: `adiantamento_${m}`,
        tipo: "adiantamento",
        descricao: "Recebimento de Adiantamento (Vale)",
        data: dataAd,
        valor: estado.adiantamento || 0,
        saldoAcumulado: 0,
      });
    }
  }

  // 3. SAÍDAS - Contas Fixas Pendentes
  estado.fixas
    .filter(f => f.status === "pendente")
    .forEach(f => {
      const vencExato = obterProximoVencimentoExato(f, hoje);
      // Projetar para o mês corrente e para o próximo
      for (let m = 0; m < 2; m++) {
        const dataVenc = new Date(vencExato);
        dataVenc.setMonth(dataVenc.getMonth() + m);
        
        events.push({
          id: `fixa_${f.id}_${m}`,
          tipo: "fixa",
          descricao: `Conta Fixa: ${f.nome}`,
          data: dataVenc,
          valor: -f.valor,
          saldoAcumulado: 0,
          origemId: f.id,
        });
      }
    });

  // 4. SAÍDAS - Lançamentos manuais futuros (data >= hoje)
  estado.lancamentos
    .filter(l => {
      const d = parseLocalDate(l.data);
      return d >= hoje;
    })
    .forEach(l => {
      if (l.tipo === "debito" && !l.terceiro) {
        events.push({
          id: l.id,
          tipo: "debito",
          descricao: l.descricao,
          data: parseLocalDate(l.data),
          valor: -l.valor,
          saldoAcumulado: 0,
          origemId: l.id,
        });
      }
      if (l.tipo === "estorno" && !l.cardId && !l.terceiro) {
        events.push({
          id: l.id,
          tipo: "estorno",
          descricao: `Estorno recebido: ${l.descricao}`,
          data: parseLocalDate(l.data),
          valor: l.valor,
          saldoAcumulado: 0,
          origemId: l.id,
        });
      }
    });

  // 5. SAÍDAS - Faturas de Cartões de Crédito (na data de vencimento)
  estado.cards.forEach(c => {
    // Projetar os próximos 2 vencimentos de fatura
    const dProximoVenc = proximaData(c.vencimento, hoje);
    
    for (let m = 0; m < 2; m++) {
      const dataVenc = new Date(dProximoVenc);
      dataVenc.setMonth(dataVenc.getMonth() + m);

      let valorFatura = 0;
      if (m === 0 && c.valorFaturaAtual !== undefined && c.valorFaturaAtual > 0) {
        // Se houver dívida inicial injetada no onboarding para a primeira fatura, usa ela
        valorFatura = c.valorFaturaAtual;
      } else {
        // Senão, calcula dinamicamente baseado nos lançamentos
        valorFatura = calcularFatura(c, estado.lancamentos, dataVenc, false);
      }

      // Se a fatura do mês atual já foi marcada como paga, não lança débito na timeline
      if (m === 0 && c.faturaPaga) {
        continue;
      }

      if (valorFatura > 0) {
        events.push({
          id: `fatura_${c.id}_${m}`,
          tipo: "fatura_cartao",
          descricao: `Fatura Cartão: ${c.nome}`,
          data: dataVenc,
          valor: -valorFatura,
          saldoAcumulado: 0,
          origemId: c.id,
        });
      }
    }
  });

  // 6. ORDENAÇÃO CRONOLÓGICA DAS TRANSAÇÕES
  events.sort((a, b) => {
    const diff = a.data.getTime() - b.data.getTime();
    if (diff !== 0) return diff;
    // Em caso de empate no mesmo dia: Entradas (positivo) processam antes de Saídas (negativo)
    return b.valor - a.valor;
  });

  // 7. COMPUTAÇÃO DO FLUXO DE CAIXA (Running Balance)
  let currentBalance = estado.saldoInicial;
  events.forEach(ev => {
    if (ev.tipo !== "saldo_inicial") {
      currentBalance += ev.valor;
    }
    ev.saldoAcumulado = currentBalance;
  });

  // 8. CÁLCULO DE DISPONIBILIDADE E BOTTLENECK (Gargalo antes da próxima renda)
  // Encontra a data da próxima entrada de dinheiro (salário ou adiantamento) estritamente no futuro
  const proximaEntradaEvent = events.find(ev => ev.data > hoje && (ev.tipo === "salario" || ev.tipo === "adiantamento"));
  const dataProximaEntrada = proximaEntradaEvent ? proximaEntradaEvent.data : new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());

  // Encontra o menor saldo acumulado no intervalo de hoje até o dia anterior à próxima renda
  const eventosNoCiclo = events.filter(ev => ev.data >= hoje && ev.data < dataProximaEntrada);
  const menorSaldoNoCiclo = eventosNoCiclo.length > 0
    ? Math.min(...eventosNoCiclo.map(ev => ev.saldoAcumulado))
    : currentBalance;

  // A disponibilidade real é o menor saldo antes de cair o próximo pagamento
  const disponibilidade = menorSaldoNoCiclo;
  const diasAteProximaEntrada = diasEntre(hoje, dataProximaEntrada);
  const porDia = disponibilidade / diasAteProximaEntrada;

  return {
    saldoAtual: events[0]?.saldoAcumulado ?? estado.saldoInicial,
    disponibilidade,
    porDia,
    diasAteProximaEntrada,
    dataProximaEntrada,
    timeline: events,
    rendaMensalTotal: estado.salario + (estado.ticketTransporte || 0) + (estado.adiantamento || 0),
  };
}

// ---------- Componente ----------
function AppMvp() {
  const [estado, setEstado] = useState<Estado>(estadoInicial);
  const [hidratado, setHidratado] = useState(false);

  // Estados do Importador
  const [mostrarImportador, setMostrarImportador] = useState(false);
  const [textoFatura, setTextoFatura] = useState("");
  const [cartaoImportadorId, setCartaoImportadorId] = useState("");
  const [importacoesPrevia, setImportacoesPrevia] = useState<(Omit<Lancamento, "id"> & { tempId: string; selecionado: boolean })[]>([]);

  // Estados para Edição Inline
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
  const [editFixaDataVencimento, setEditFixaDataVencimento] = useState("");

  const [idEditandoCard, setIdEditandoCard] = useState<string | null>(null);
  const [editCardNome, setEditCardNome] = useState("");
  const [editCardLimite, setEditCardLimite] = useState<number>(0);
  const [editCardFech, setEditCardFech] = useState(25);
  const [editCardVenc, setEditCardVenc] = useState(5);
  const [editCardFaturaPendente, setEditCardFaturaPendente] = useState(0);
  const [editCardFaturaPaga, setEditCardFaturaPaga] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const lancamentosMapeados = (parsed.lancamentos || []).map((l: any) => ({ ...l, id: l.id || uid(), dataRegistro: l.dataRegistro || l.data, ativo: l.ativo !== undefined ? l.ativo : true }));
        const fixasMapeadas = (parsed.fixas || []).map((f: any) => ({ ...f, id: f.id || uid(), status: f.status || "pendente" }));
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

  // MOTOR DE CÁLCULO FINANCEIRO EXCLUSIVO (FINANCIAL ENGINE)
  const calculo = useMemo(() => {
    return runFinancialEngine(estado, hoje);
  }, [estado, hoje]);

  // --- CONTROLADORES DOS FORMULÁRIOS E EDIÇÃO ---
  const iniciarEdicaoFixa = (f: Fixa) => {
    setIdEditandoFixa(f.id);
    setEditFixaNome(f.nome);
    setEditFixaValor(f.valor);
    setEditFixaDataVencimento(f.dataVencimento || obterDataPadrao(10, 0));
  };

  const salvarEdicaoFixa = () => {
    setEstado((s) => ({
      ...s,
      fixas: s.fixas.map((f) => f.id === idEditandoFixa ? { ...f, nome: editFixaNome, valor: editFixaValor, dataVencimento: editFixaDataVencimento } : f)
    }));
    setIdEditandoFixa(null);
  };

  const iniciarEdicaoCard = (c: Card) => {
    setIdEditandoCard(c.id);
    setEditCardNome(c.nome);
    setEditCardLimite(c.limite);
    setEditCardFech(c.fechamento);
    setEditCardVenc(c.vencimento);
    setEditCardFaturaPendente(c.valorFaturaAtual || 0);
    setEditCardFaturaPaga(!!c.faturaPaga);
  };

  const salvarEdicaoCard = () => {
    setEstado((s) => ({
      ...s,
      cards: s.cards.map((c) => c.id === idEditandoCard ? { ...c, nome: editCardNome, limite: editCardLimite, fechamento: editCardFech, vencimento: editCardVenc, valorFaturaAtual: editCardFaturaPendente, faturaPaga: editCardFaturaPaga } : c)
    }));
    setIdEditandoCard(null);
  };

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

  const salvarEdicao = () => {
    setEstado((s) => ({
      ...s,
      lancamentos: s.lancamentos.map((l) => l.id === idEditando ? { ...l, descricao: editDescricao, valor: editValor, tipo: editTipo, cardId: (editTipo.includes("credito") || editTipo === "estorno") ? (editCardId || undefined) : undefined, parcelas: editTipo === "credito_parcelado" ? editParcelas : undefined, parcelaAtual: (editTipo === "credito_parcelado" && editEmAndamento) ? editParcelaAtual : undefined, emAndamento: (editTipo === "credito_parcelado" && editEmAndamento) ? true : undefined, data: editData, terceiro: editTerceiro || undefined, terceiroNome: editTerceiro && editTerceiroNome ? editTerceiroNome : undefined } : l)
    }));
    setIdEditando(null);
  };

  const cancelarAssinatura = (id: string) => {
    setEstado((s) => ({
      ...s,
      lancamentos: s.lancamentos.map((l) => l.id === id ? { ...l, ativo: false } : l),
    }));
  };

  const reativarAssinatura = (id: string) => {
    setEstado((s) => ({
      ...s,
      lancamentos: s.lancamentos.map((l) => l.id === id ? { ...l, ativo: true } : l),
    }));
  };

  const aoMudarCartaoImportador = (id: string) => {
    setCartaoImportadorId(id);
    setImportacoesPrevia(prev => prev.map(item => ({ ...item, cardId: id || undefined })));
  };

  const rodarParserFatura = () => {
    if (!textoFatura) return;
    let cardIdFinal = cartaoImportadorId;
    if (!cardIdFinal) {
      cardIdFinal = detectarCartaoPorTexto(textoFatura, estado.cards) || (estado.cards[0]?.id || "");
      setCartaoImportadorId(cardIdFinal);
    }
    const resultado = parsePastedInvoiceText(textoFatura, cardIdFinal, hoje);
    setImportacoesPrevia(resultado.map(item => ({ ...item, tempId: uid(), selecionado: true })));
  };

  const confirmarImportacaoLote = () => {
    const listosParaImportar = importacoesPrevia
      .filter(item => item.selecionado)
      .map(({ tempId, selecionado, ...rest }) => ({
        ...rest,
        id: uid(),
        dataRegistro: hoje.toISOString().slice(0, 10)
      }));

    if (listosParaImportar.length === 0) return alert("Nenhum lançamento selecionado!");
    setEstado((s) => ({ ...s, lancamentos: [...s.lancamentos, ...listosParaImportar] }));
    setTextoFatura("");
    setImportacoesPrevia([]);
    setMostrarImportador(false);
    alert(`${listosParaImportar.length} lançamentos importados com sucesso!`);
  };

  // --- SUBMETEDORES DO ASSISTENTE DE ONBOARDING ---
  const avancarOnboarding = () => {
    setEstado((s) => ({ ...s, onboardingPasso: s.onboardingPasso + 1 }));
  };

  const finalizarOnboarding = () => {
    // Aplicação das regras de negócio informadas nas respostas do Onboarding
    let contasFixasAtualizadas = [...estado.fixas];
    if (estado.pagouContasAnteriores) {
      // Se respondeu SIM, marca todas as contas vencidas antes de hoje como quitadas ("paga")
      contasFixasAtualizadas = estado.fixas.map(f => {
        const dVenc = parseLocalDate(f.dataVencimento);
        if (dVenc < hoje) {
          return { ...f, status: "paga" as const };
        }
        return f;
      });
    }

    setEstado((s) => ({
      ...s,
      fixas: contasFixasAtualizadas,
      onboardingCompleto: true,
    }));
  };

  // --- RENDERIZADOR DO ONBOARDING WIZARD ---
  if (!estado.onboardingCompleto) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold">Passo {estado.onboardingPasso} de 5 · Boas-vindas</p>
          
          {estado.onboardingPasso === 1 && (
            <div className="mt-4 space-y-4">
              <h2 className="font-serif text-3xl text-foreground">Qual o seu saldo disponível hoje?</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">Insira a soma exata de todo o dinheiro líquido que você possui em conta corrente, carteira ou poupança neste momento. Não inclua limite de cartão de crédito.</p>
              <Field label="Saldo disponível (R$)">
                <input
                  type="text"
                  value={formatarMoedaInput(estado.saldoInicial)}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setEstado((s) => ({ ...s, saldoInicial: Number(digits) / 100 }));
                  }}
                  className={inputCls}
                />
              </Field>
              <button onClick={avancarOnboarding} className="w-full mt-2 rounded-md bg-primary py-2 text-sm text-primary-foreground font-semibold cursor-pointer">Continuar</button>
            </div>
          )}

          {estado.onboardingPasso === 2 && (
            <div className="mt-4 space-y-4">
              <h2 className="font-serif text-3xl text-foreground">Seu último salário já caiu?</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">Se o seu salário mais recente já foi depositado e faz parte do saldo que você informou no Passo 1, marque SIM. Se você está esperando o próximo salário cair, marque NÃO.</p>
              <div className="grid grid-cols-2 gap-3 py-2">
                <button
                  onClick={() => setEstado((s) => ({ ...s, ultimoSalarioJaCaiu: true }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${estado.ultimoSalarioJaCaiu ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  SIM, já caiu
                </button>
                <button
                  onClick={() => setEstado((s) => ({ ...s, ultimoSalarioJaCaiu: false }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${!estado.ultimoSalarioJaCaiu ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  NÃO, estou esperando
                </button>
              </div>
              <button onClick={avancarOnboarding} className="w-full mt-2 rounded-md bg-primary py-2 text-sm text-primary-foreground font-semibold cursor-pointer">Continuar</button>
            </div>
          )}

          {estado.onboardingPasso === 3 && (
            <div className="mt-4 space-y-4">
              <h2 className="font-serif text-3xl text-foreground">Contas fixas vencidas</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">Você já quitou todas as despesas e boletos fixos que venceram antes do dia de hoje?</p>
              <div className="grid grid-cols-2 gap-3 py-2">
                <button
                  onClick={() => setEstado((s) => ({ ...s, pagouContasAnteriores: true }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${estado.pagouContasAnteriores ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  SIM, tudo pago
                </button>
                <button
                  onClick={() => setEstado((s) => ({ ...s, pagouContasAnteriores: false }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${!estado.pagouContasAnteriores ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  NÃO, tenho pendentes
                </button>
              </div>
              <button onClick={avancarOnboarding} className="w-full mt-2 rounded-md bg-primary py-2 text-sm text-primary-foreground font-semibold cursor-pointer">Continuar</button>
            </div>
          )}

          {estado.onboardingPasso === 4 && (
            <div className="mt-4 space-y-4">
              <h2 className="font-serif text-3xl text-foreground">Seu cartão possui fatura pendente?</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">Caso você tenha faturas de cartão de crédito em andamento que vencerão no ciclo atual, responda SIM para inserirmos esses valores como dívidas existentes herdadas.</p>
              <div className="grid grid-cols-2 gap-3 py-2">
                <button
                  onClick={() => setEstado((s) => ({ ...s, temFaturaPendente: true }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${estado.temFaturaPendente ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  SIM, tenho faturas
                </button>
                <button
                  onClick={() => setEstado((s) => ({ ...s, temFaturaPendente: false }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${!estado.temFaturaPendente ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  NÃO, sem faturas
                </button>
              </div>
              <button onClick={avancarOnboarding} className="w-full mt-2 rounded-md bg-primary py-2 text-sm text-primary-foreground font-semibold cursor-pointer">Continuar</button>
            </div>
          )}

          {estado.onboardingPasso === 5 && (
            <div className="mt-4 space-y-4">
              <h2 className="font-serif text-3xl text-foreground">Começar controle hoje?</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">Deseja que o algoritmo considere estritamente os lançamentos e despesas criados a partir de hoje? (Recomendado para evitar poluição visual de ciclos passados).</p>
              <div className="grid grid-cols-1 gap-3 py-2">
                <button
                  onClick={() => setEstado((s) => ({ ...s, modoComecarHoje: true }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${estado.modoComecarHoje ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  SIM, começar de hoje (Recomendado)
                </button>
                <button
                  onClick={() => setEstado((s) => ({ ...s, modoComecarHoje: false }))}
                  className={`rounded-md py-3 text-sm font-semibold border cursor-pointer ${!estado.modoComecarHoje ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border"}`}
                >
                  NÃO, considerar todo o histórico
                </button>
              </div>
              <button onClick={finalizarOnboarding} className="w-full mt-2 rounded-md bg-primary py-3 text-sm text-primary-foreground font-bold cursor-pointer uppercase tracking-wider">Concluir Configuração 🪄</button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // --- RENDERIZADOR DO APLICATIVO CENTRAL (MVP PRINCIPAL) ---
  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <div className="flex justify-between items-center text-sm text-muted-foreground mb-4">
        <Link to="/" className="hover:text-foreground">← Voltar ao roadmap</Link>
        <button onClick={() => setEstado((s) => ({ ...s, onboardingCompleto: false, onboardingPasso: 1 }))} className="underline cursor-pointer">🪄 Refazer Onboarding</button>
      </div>

      <header className="mt-2">
        <p className="text-sm uppercase tracking-[0.2em] text-accent font-semibold">MVP · Protótipo funcional</p>
        <h1 className="mt-3 font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl">Quanto você pode gastar <em className="text-accent">hoje</em>?</h1>
      </header>

      {/* PAINEL DE DISPONIBILIDADE E SALDOS */}
      <section className="mt-10 rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Card de Disponibilidade para Gastar */}
          <div className="rounded-xl border border-border bg-parchment/30 p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Disponível por dia até {calculo.proxSalario.toLocaleString("pt-BR", { day: "2-digit", month: "short" })}</p>
            <p className={`mt-2 font-serif text-5xl font-bold ${calculo.porDia < 0 ? "text-destructive" : "text-foreground"}`}>{brl(calculo.porDia)}</p>
            <p className="mt-2 text-xs text-muted-foreground">{calculo.diasAteProximaEntrada} {calculo.diasAteProximaEntrada === 1 ? "dia restante" : "dias restantes"} · total livre {brl(calculo.disponibilidade)}</p>
          </div>

          {/* Card de Saldo Atual Disponível */}
          <div className={`rounded-xl border p-6 ${calculo.saldoAtual < 0 ? "bg-destructive/10 border-destructive/30" : "bg-parchment/30 border-border"}`}>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Saldo Atual Líquido (Hoje)</p>
            <p className={`mt-2 font-serif text-5xl font-bold ${calculo.saldoAtual < 0 ? "text-destructive" : "text-foreground"}`}>{brl(calculo.saldoAtual)}</p>
            
            {calculo.saldoAtual < 0 ? (
              <p className="mt-2 text-xs text-destructive font-semibold">⚠️ Você já consumiu dinheiro que pertence às próximas entradas.</p>
            ) : calculo.saldoAtual === 0 ? (
              <p className="mt-2 text-xs text-amber-600 font-semibold">Seu saldo disponível acabou.</p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Dinheiro real em mãos no momento.</p>
            )}
          </div>
        </div>

        {/* ALERTA DE COMPROMETIMENTO EM CASO DE SALDO NEGATIVO */}
        {calculo.saldoAtual < 0 && (
          <div className="mt-6 rounded-xl bg-destructive/15 border border-destructive/30 p-4 text-xs sm:text-sm text-destructive flex items-start gap-3">
            <span className="text-lg">🛑</span>
            <div>
              <span className="font-semibold block sm:inline">Análise de Endividamento:</span> Seu saldo atual de <strong>{brl(calculo.saldoAtual)}</strong> já compromete o seu próximo salário previsto de <strong>{brl(estado.salario)}</strong>. Seu saldo disponível após o recebimento será reduzido para <strong>{brl(estado.salario + calculo.saldoAtual)}</strong>.
            </div>
          </div>
        )}

        {/* ESPIADA NO PRÓXIMO CICLO (🔮 MODO SIMULAÇÃO) */}
        {calculo.temProximoCiclo && (
          <div className="mt-4 rounded-xl bg-accent/10 border border-accent/25 p-4 text-xs sm:text-sm text-accent-foreground flex items-start gap-3">
            <span className="text-lg">🔮</span>
            <div>
              <span className="font-semibold block sm:inline">Espiada no amanhã:</span> A partir de <strong>{calculo.proxSalario.toLocaleString("pt-BR", { day: "2-digit", month: "short" })}</strong>, sua projeção diária será de <strong>{brl(calculo.porDiaProximoCiclo)} por dia</strong> até {calculo.fimProximoCiclo.toLocaleString("pt-BR", { day: "2-digit", month: "short" })} ({calculo.diasProximoCiclo} dias · {brl(calculo.disponivelProximoCiclo)} livres após contas e faturas futuras).
            </div>
          </div>
        )}
      </section>

      {/* CONFIGURAÇÃO DE RENDA E DATA DO SALDO INICIAL */}
      <Bloco titulo="1. Renda e Saldo Inicial">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Saldo Inicial Disponível (R$)">
            <input type="text" value={formatarMoedaInput(estado.saldoInicial)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEstado((s) => ({ ...s, saldoInicial: Number(digits) / 100 })); }} className={inputCls} />
          </Field>
          <Field label="Salário líquido do ciclo (R$)">
            <input type="text" value={formatarMoedaInput(estado.salario)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEstado((s) => ({ ...s, salario: Number(digits) / 100 })); }} className={inputCls} />
          </Field>
          <Field label="Ticket Transporte / VT (R$)">
            <input type="text" value={formatarMoedaInput(estado.ticketTransporte)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEstado((s) => ({ ...s, ticketTransporte: Number(digits) / 100 })); }} className={inputCls} />
          </Field>
          <Field label="Data estimada do próximo salário">
            <input type="date" value={estado.dataProximoSalario || obterDataPadrao(5, 1)} onChange={(e) => setEstado((s) => ({ ...s, dataProximoSalario: e.target.value }))} className={inputCls} />
          </Field>

          <div className="sm:col-span-2 flex items-center gap-2 py-2 border-t border-border/40 mt-2">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer font-medium">
              <input type="checkbox" checked={!!estado.temAdiantamento} onChange={(e) => setEstado((s) => ({ ...s, temAdiantamento: e.target.checked }))} className="h-4 w-4 text-primary focus:ring-primary border-border rounded" />
              <span>Recebe adiantamento quinzenal (Vale)?</span>
            </label>
          </div>

          {estado.temAdiantamento && (
            <>
              <Field label="Valor do adiantamento (R$)">
                <input type="text" value={formatarMoedaInput(estado.adiantamento)} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setEstado((s) => ({ ...s, adiantamento: Number(digits) / 100 })); }} className={inputCls} />
              </Field>
              <Field label="Data estimada do próximo adiantamento">
                <input type="date" value={estado.dataProximoAdiantamento || obterDataPadrao(15, 1)} onChange={(e) => setEstado((s) => ({ ...s, dataProximoAdiantamento: e.target.value }))} className={inputCls} />
              </Field>
            </>
          )}
        </div>
      </Bloco>

      {/* FLUXO DE CAIXA E LINHA DO TEMPO CRONOLÓGICA (TRUE CASH FLOW TIMELINE) */}
      <Bloco titulo="2. Fluxo de Caixa / Linha do Tempo">
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          Esta é a cronologia real do seu dinheiro. Cada salário recebido aumenta o saldo, e cada conta ou fatura paga diminui seu dinheiro disponível ao longo dos dias, mantendo a visibilidade do saldo acumulado futuro.
        </p>
        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 divide-y divide-border">
          {calculo.timeline.map((ev, index) => {
            const isNegative = ev.valor < 0;
            return (
              <div key={ev.id + index} className="flex items-center justify-between py-3 text-xs sm:text-sm">
                <div className="flex items-start gap-3">
                  <span className="text-lg mt-0.5">
                    {ev.tipo === "saldo_inicial" ? "📥" : isNegative ? "💸" : "💰"}
                  </span>
                  <div>
                    <span className="font-semibold text-foreground block">{ev.descricao}</span>
                    <span className="text-xs text-muted-foreground block">
                      {ev.data.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`font-mono font-semibold block ${isNegative ? "text-foreground" : "text-green-600"}`}>
                    {isNegative ? "" : "+"}{brl(ev.valor)}
                  </span>
                  <span className={`text-xs block ${ev.saldoAcumulado < 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                    Acumulado: {brl(ev.saldoAcumulado)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Bloco>

      {/* CONTAS FIXAS COM STATUS EXPLÍCITO */}
      <Bloco titulo="3. Contas fixas">
        <ul className="divide-y divide-border">
          {estado.fixas.map((f) => idEditandoFixa === f.id ? (
            <li key={f.id} className="py-4 space-y-3 bg-muted/30 p-4 rounded-lg my-2 border border-border/50">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Nome"><input value={editFixaNome} onChange={(e) => setEditFixaNome(e.target.value)} className={inputCls} /></Field>
                <Field label="Valor"><input type="text" value={formatarMoedaInput(editFixaValor)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setEditFixaValor(Number(d) / 100); }} className={inputCls} /></Field>
                <Field label="Vencimento"><input type="date" value={editFixaDataVencimento} onChange={(e) => setEditFixaDataVencimento(e.target.value)} className={inputCls} /></Field>
                <Field label="Status">
                  <select value={f.status} onChange={(e) => setEstado(s => ({ ...s, fixas: s.fixas.map(x => x.id === f.id ? { ...x, status: e.target.value as any } : x) }))} className={inputCls}>
                    <option value="pendente">Pendente</option>
                    <option value="paga">Paga (Quitada)</option>
                    <option value="cancelada">Cancelada</option>
                  </select>
                </Field>
              </div>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setIdEditandoFixa(null)} className="text-xs p-2">Cancelar</button><button type="button" onClick={salvarEdicaoFixa} className="rounded bg-primary px-3 py-1 text-xs text-white">Salvar</button></div>
            </li>
          ) : (
            <li key={f.id} className="flex items-center justify-between py-3">
              <div className="flex-1 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    {f.nome}
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${f.status === "paga" ? "bg-green-100 text-green-700" : f.status === "cancelada" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-700"}`}>
                      {f.status}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">Próximo vencimento: {obterProximoVencimentoExato(f, hoje).toLocaleDateString("pt-BR")}</p>
                </div>
                <p className="font-semibold">{brl(f.valor)}</p>
              </div>
              <div className="flex gap-2 ml-4">
                {f.status === "pendente" && (
                  <button onClick={() => setEstado(s => ({ ...s, fixas: s.fixas.map(x => x.id === f.id ? { ...x, status: "paga" } : x) }))} className="text-xs underline text-green-600">marcar como paga</button>
                )}
                <button onClick={() => iniciarEdicaoFixa(f)} className="text-xs underline">editar</button>
                <button onClick={() => setEstado(s => ({ ...s, fixas: s.fixas.filter(x => x.id !== f.id) }))} className="text-xs text-destructive underline">remover</button>
              </div>
            </li>
          ))}
        </ul>
        <FormFixa onAdd={(f) => setEstado((s) => ({ ...s, fixas: [...s.fixas, { ...f, id: uid(), status: "pendente" }] }))} />
      </Bloco>

      {/* CARDS COM DIVIDA DE ONBOARDING */}
      <Bloco titulo="4. Cartões de crédito">
        <ul className="divide-y divide-border">
          {estado.cards.map((c) => idEditandoCard === c.id ? (
            <li key={c.id} className="py-4 space-y-3 bg-muted/30 p-4 rounded-lg my-2 border border-border/50">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Nome"><input value={editCardNome} onChange={(e) => setEditCardNome(e.target.value)} className={inputCls} /></Field>
                <Field label="Limite"><input type="text" value={formatarMoedaInput(editCardLimite)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setEditCardLimite(Number(d) / 100); }} className={inputCls} /></Field>
                <Field label="Vencendo Fatura Atual (R$)"><input type="text" value={formatarMoedaInput(editCardFaturaPendente)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setEditCardFaturaPendente(Number(d) / 100); }} className={inputCls} /></Field>
                <Field label="Fecha"><input type="number" value={editCardFech} onChange={(e) => setEditCardFech(Number(e.target.value) || 1)} className={inputCls} /></Field>
                <Field label="Vence"><input type="number" value={editCardVenc} onChange={(e) => setEditCardVenc(Number(e.target.value) || 1)} className={inputCls} /></Field>
              </div>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setIdEditandoCard(null)} className="text-xs p-2">Cancelar</button><button type="button" onClick={salvarEdicaoCard} className="rounded bg-primary px-3 py-1 text-xs text-white">Salvar</button></div>
            </li>
          ) : (
            <li key={c.id} className="flex items-center justify-between py-3">
              <div className="flex-1 flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium flex items-center gap-2">
                    {c.nome}
                    {c.faturaPaga && <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">paga</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">Fecha {c.fechamento} · Vence {c.vencimento}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">
                    {c.valorFaturaAtual !== undefined && c.valorFaturaAtual > 0 
                      ? brl(c.valorFaturaAtual) 
                      : brl(calcularFatura(c, estado.lancamentos, proximaData(c.vencimento, hoje), true))}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Sua parte: {c.valorFaturaAtual !== undefined && c.valorFaturaAtual > 0 
                      ? brl(c.valorFaturaAtual) 
                      : brl(calcularFatura(c, estado.lancamentos, proximaData(c.vencimento, hoje), false))}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 ml-4">
                {!c.faturaPaga && (
                  <button onClick={() => setEstado(s => ({ ...s, cards: s.cards.map(x => x.id === c.id ? { ...x, faturaPaga: true } : x) }))} className="text-xs underline text-green-600">marcar fatura como paga</button>
                )}
                {c.faturaPaga && (
                  <button onClick={() => setEstado(s => ({ ...s, cards: s.cards.map(x => x.id === c.id ? { ...x, faturaPaga: false } : x) }))} className="text-xs underline text-amber-600">reativar fatura</button>
                )}
                <button onClick={() => iniciarEdicaoCard(c)} className="text-xs underline">editar</button>
                <button onClick={() => setEstado(s => ({ ...s, cards: s.cards.filter(x => x.id !== c.id) }))} className="text-xs text-destructive underline">remover</button>
              </div>
            </li>
          ))}
        </ul>
        <FormCard onAdd={(c) => setEstado((s) => ({ ...s, cards: [...s.cards, { ...c, id: uid(), faturaPaga: false, valorFaturaAtual: 0 }] }))} />
      </Bloco>

      {/* LANÇAMENTOS COM EDIÇÃO INLINE */}
      <Bloco titulo="5. Lançamentos">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setMostrarImportador(!mostrarImportador)}
            className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent cursor-pointer"
          >
            {mostrarImportador ? "❌ Fechar Importador" : "🪄 Importador Inteligente (Copia-e-Cola)"}
          </button>
        </div>

        {mostrarImportador && (
          <div className="mb-6 space-y-4 rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Abra o app ou PDF do seu banco, copie os lançamentos da sua fatura e cole no campo abaixo. Nosso algoritmo lerá automaticamente as datas, valores e identificará parcelas antigas!
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cartão de Destino">
                <select value={cartaoImportadorId} onChange={(e) => aoMudarCartaoImportador(e.target.value)} className={inputCls}>
                  <option value="">Selecione um cartão...</option>
                  {estado.cards.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
                </select>
              </Field>
              <div className="hidden sm:block"></div>
              <div className="sm:col-span-2">
                <Field label="Texto copiado da fatura">
                  <textarea
                    rows={4}
                    value={textoFatura}
                    onChange={(e) => setTextoFatura(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-ring focus:ring-1 focus:ring-ring"
                    placeholder="Ex.:&#10;12/07 Uber R$ 25,50&#10;14 JUL POSTO IPIRANGA 120,00&#10;15 JUL COMPRA PARCELADA 02/05 50,00"
                  />
                </Field>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={rodarParserFatura}
                className="rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:bg-accent/95 cursor-pointer"
              >
                Analisar Texto da Fatura
              </button>
            </div>

            {importacoesPrevia.length > 0 && (
              <div className="mt-4 space-y-3 rounded-lg border border-border bg-background p-4">
                <h4 className="font-serif text-sm font-semibold text-foreground">Compras detectadas na fatura ({importacoesPrevia.length})</h4>
                <div className="max-h-48 overflow-y-auto divide-y divide-border pr-2">
                  {importacoesPrevia.map((item, index) => {
                    const card = estado.cards.find(c => c.id === item.cardId);
                    return (
                      <div key={item.tempId} className="flex items-center justify-between py-2 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={item.selecionado}
                            onChange={(e) => {
                              const updated = [...importacoesPrevia];
                              updated[index].selecionado = e.target.checked;
                              setImportacoesPrevia(updated);
                            }}
                            className="h-3.5 w-3.5"
                          />
                          <div>
                            <span className="font-semibold">{item.descricao}</span>
                            <span className="text-[10px] text-muted-foreground block">
                              {parseLocalDate(item.data).toLocaleDateString("pt-BR")} · {
                                item.tipo === "credito_parcelado" 
                                  ? `parcela ${item.parcelaAtual}/${item.parcelas}` 
                                  : "à vista"
                              } {card ? `no ${card.nome}` : ""}
                            </span>
                          </div>
                        </label>
                        <span className="font-mono font-semibold">{brl(item.valor)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={confirmarImportacaoLote}
                    className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/95 cursor-pointer"
                  >
                    Importar Selecionados para o Cartão
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LISTAGEM PRINCIPAL */}
        {[...estado.lancamentos].length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {[...estado.lancamentos].sort((a, b) => a.data < b.data ? 1 : -1).map((l) => idEditando === l.id ? (
              <li key={l.id} className="py-4 space-y-3 bg-muted/30 p-4 rounded-lg my-2 border border-border/50">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Descrição"><input value={editDescricao} onChange={(e) => setEditDescricao(e.target.value)} className={inputCls} /></Field>
                  <Field label="Valor"><input type="text" value={formatarMoedaInput(editValor)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setEditValor(Number(d) / 100); }} className={inputCls} /></Field>
                  <Field label="Tipo">
                    <select value={editTipo} onChange={(e) => setEditTipo(e.target.value as TipoLanc)} className={inputCls}>
                      <option value="debito">Débito</option>
                      <option value="estorno">Estorno</option>
                      <option value="credito_avista">À vista</option>
                      <option value="credito_parcelado">Parcelado</option>
                      <option value="credito_recorrente">Recorrente (Assinatura)</option>
                    </select>
                  </Field>
                  <Field label="Data"><input type="date" value={editData} onChange={(e) => setEditData(e.target.value)} className={inputCls} /></Field>
                  
                  {(editTipo.includes("credito") || editTipo === "estorno") && (
                    <Field label={editTipo === "estorno" ? "Cartão (opcional)" : "Cartão"}>
                      <select value={editCardId} onChange={(e) => setEditCardId(e.target.value)} className={inputCls}>
                        <option value="">{editTipo === "estorno" ? "Não (recebi na conta)" : "Selecione…"}</option>
                        {estado.cards.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
                      </select>
                    </Field>
                  )}
                </div>

                {/* Campos de Terceiro na Edição Inline */}
                <div className="space-y-3 mt-1">
                  <label className="flex items-center gap-2 text-xs cursor-pointer font-medium text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={editTerceiro}
                      onChange={(e) => setEditTerceiro(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <span>Gasto de terceiro (não contar no cálculo pessoal)</span>
                  </label>
                  {editTerceiro && (
                    <div className="max-w-xs">
                      <Field label="Nome de quem gastou">
                        <input
                          value={editTerceiroNome}
                          onChange={(e) => setEditTerceiroNome(e.target.value)}
                          className={inputCls}
                          placeholder="Ex: Mãe"
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
            ) : (
              <li key={l.id} className="flex items-center justify-between py-3">
                <div className="flex-1 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">
                      {l.descricao}
                      {l.terceiro && <span className="ml-2 text-[10px] bg-accent/10 px-1 uppercase tracking-wider text-accent font-semibold">terceiro</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {parseLocalDate(l.data).toLocaleDateString("pt-BR")} · {
                        l.tipo === "debito" 
                          ? "débito" 
                          : l.tipo === "estorno"
                            ? `${l.cardId ? `estorno no ${estado.cards.find(x => x.id === l.cardId)?.nome}` : "estorno em conta"}`
                            : l.tipo === "credito_recorrente"
                              ? `${estado.cards.find(x => x.id === l.cardId)?.nome || "cartão"} · assinatura ${l.ativo === false ? "(cancelada)" : ""}`
                              : `${estado.cards.find(x => x.id === l.cardId)?.nome || "cartão"} · ${obterLabelParcela(l, estado.cards.find(x => x.id === l.cardId), hoje)}`
                      }
                    </p>
                  </div>
                  <p className={`font-semibold ${l.tipo === "estorno" ? "text-green-600" : ""}`}>{l.tipo === "estorno" ? "+" : ""}{brl(l.valor)}</p>
                </div>
                <div className="flex gap-2 ml-4">
                  {l.tipo === "credito_recorrente" && (
                    <button
                      onClick={() => {
                        if (l.ativo === false) {
                          reativarAssinatura(l.id);
                        } else {
                          if (confirm(`Deseja parar de pagar a assinatura "${l.descricao}"?`)) {
                            cancelarAssinatura(l.id);
                          }
                        }
                      }}
                      className={`text-xs underline cursor-pointer font-medium ${l.ativo === false ? "text-green-600 hover:text-green-700" : "text-amber-600 hover:text-amber-700"}`}
                    >
                      {l.ativo === false ? "reativar" : "cancelar"}
                    </button>
                  )}
                  <button onClick={() => iniciarEdicao(l)} className="text-xs underline cursor-pointer">editar</button>
                  <button onClick={() => setEstado(s => ({ ...s, lancamentos: s.lancamentos.filter(x => x.id !== l.id) }))} className="text-xs text-destructive underline cursor-pointer">remover</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <FormLanc cards={estado.cards} onAdd={(l) => setEstado((s) => ({ ...s, lancamentos: [...s.lancamentos, { ...l, id: uid(), dataRegistro: hoje.toISOString().slice(0, 10), ativo: true }] }))} />
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
  const [nome, setNome] = useState(""); const [valor, setValor] = useState<number>(0); const [dataVencimento, setDataVencimento] = useState(obterDataPadrao(10, 0));
  return (<form onSubmit={(e) => { e.preventDefault(); if (!nome || !valor) return; onAdd({ nome, valor, dataVencimento }); setNome(""); setValor(0); }} className="mt-4 grid gap-3 sm:grid-cols-[1fr_140px_160px_auto]"><input placeholder="Ex.: Aluguel" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} /><input type="text" value={formatarMoedaInput(valor)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setValor(Number(d) / 100); }} className={inputCls} /><input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} className={inputCls} /><button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer">Adicionar</button></form>);
}

function FormCard({ onAdd }: { onAdd: (c: Omit<Card, "id">) => void }) {
  const [nome, setNome] = useState(""); const [limite, setLimite] = useState<number>(0); const [fech, setFech] = useState("25"); const [venc, setVenc] = useState("5");
  return (<form onSubmit={(e) => { e.preventDefault(); if (!nome) return; onAdd({ nome, limite: limite || 0, fechamento: Number(fech), vencimento: Number(venc) }); setNome(""); setLimite(0); }} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_140px_120px_120px_auto]"><Field label="Nome"><input placeholder="Ex.: Nubank" value={nome} onChange={(e) => setNome(e.target.value)} className={inputCls} /></Field><Field label="Limite"><input type="text" value={formatarMoedaInput(limite)} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setLimite(Number(d) / 100); }} className={inputCls} /></Field><Field label="Fecha"><input type="number" value={fech} onChange={(e) => setFech(e.target.value)} className={inputCls} /></Field><Field label="Vence"><input type="number" value={venc} onChange={(e) => setVenc(e.target.value)} className={inputCls} /></Field><div className="flex items-end"><button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer">Adicionar</button></div></form>);
}

function FormLanc({ cards, onAdd }: { cards: Card[]; onAdd: (l: Omit<Lancamento, "id">) => void }) {
  const [descricao, setDescricao] = useState(""); const [valor, setValor] = useState<number>(0); const [tipo, setTipo] = useState<TipoLanc>("debito"); const [cardId, setCardId] = useState(""); const [parcelas, setParcelas] = useState("2"); const [data, setData] = useState(new Date().toISOString().slice(0, 10)); const [terceiro, setTerceiro] = useState(false); const [emAndamento, setEmAndamento] = useState(false); const [parcelaAtual, setParcelaAtual] = useState("2");
  const ehCredito = tipo.includes("credito") || tipo === "estorno"; const ehParcelado = tipo === "credito_parcelado";
  return (<form onSubmit={(e) => { e.preventDefault(); if (!descricao || !valor) return; if (ehCredito && tipo !== "estorno" && !cardId) return alert("Selecione um cartão"); onAdd({ descricao, valor, data, tipo, cardId: (ehCredito && cardId) ? cardId : undefined, parcelas: ehParcelado ? Number(parcelas) : undefined, parcelas: ehParcelado ? Number(parcelas) : undefined, parcelaAtual: (ehParcelado && emAndamento) ? Number(parcelaAtual) : undefined, emAndamento: (ehParcelado && emAndamento) ? true : undefined, terceiro: terceiro || undefined }); setDescricao(""); setValor(0); setTerceiro(false); setEmAndamento(false); }} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="Descrição"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputCls} /></Field>
      <Field label={ehParcelado && emAndamento ? "Valor da Parcela (R$)" : "Valor (R$)"}>
        <div className="relative">
          <input
            type="text"
            value={formatarMoedaInput(valor)}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setValor(Number(d) / 100); }}
            className={inputCls}
          />
          {ehParcelado && !emAndamento && valor > 0 && (
            <span className="absolute left-0 -bottom-4 text-[10px] text-accent font-semibold">
              ✨ Projeção: {parcelas} parcelas de {brl(valor / (Number(parcelas) || 1))}
            </span>
          )}
        </div>
      </Field>
      <Field label="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value as TipoLanc)} className={inputCls}><option value="debito">Débito</option><option value="estorno">Estorno (Devolução)</option><option value="credito_avista">À vista</option><option value="credito_parcelado">Parcelado</option><option value="credito_recorrente">Recorrente (Assinatura)</option></select></Field><Field label="Data"><input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputCls} /></Field>{ehCredito && (<Field label={tipo === "estorno" ? "Cartão (opcional)" : "Cartão"}><select value={cardId} onChange={(e) => setCardId(e.target.value)} className={inputCls}><option value="">{tipo === "estorno" ? "Não (recebi na conta)" : "Selecione…"}</option>{cards.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}</select></Field>)}{ehParcelado && (<Field label="Total Parcelas"><input type="number" value={parcelas} onChange={(e) => setParcelas(e.target.value)} className={inputCls} /></Field>)}{ehParcelado && (<div className="flex items-center gap-2 pt-6"><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={emAndamento} onChange={(e) => setEmAndamento(e.target.checked)} className="h-4 w-4" /><span>Em andamento?</span></label></div>)}{ehParcelado && emAndamento && (<Field label="Parcela Atual"><input type="number" value={parcelaAtual} onChange={(e) => setParcelaAtual(e.target.value)} className={inputCls} /></Field>)}<div className="lg:col-span-4"><label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={terceiro} onChange={(e) => setTerceiro(e.target.checked)} className="h-4 w-4" /><span>Gasto de terceiro</span></label></div><div className="lg:col-span-4 mt-2"><button className="w-full rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground cursor-pointer">Adicionar lançamento</button></div></form>);
}
