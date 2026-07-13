import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/fase-1")({
  head: () => ({
    meta: [
      { title: "Fase 1 — Descoberta do problema · Quanto Posso Gastar" },
      {
        name: "description",
        content:
          "Definição do problema, personas, stakeholders, jornada, dores e objetivos — Fase 1 do case público, baseada em Design Thinking, Human Centered Design, Lean Startup e Double Diamond.",
      },
      { property: "og:title", content: "Fase 1 — Descoberta do problema" },
      {
        property: "og:description",
        content:
          "Entender profundamente o problema antes de pensar em solução. Personas, jornada, dores e objetivos.",
      },
    ],
  }),
  component: Fase1,
});

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16">
      <p className="text-xs uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
      <h2 className="mt-2 font-serif text-3xl text-foreground">{title}</h2>
      <div className="mt-6 space-y-4 text-[17px] leading-relaxed text-foreground/90">
        {children}
      </div>
    </section>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-6">
      <h3 className="font-serif text-xl text-foreground">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-4 space-y-2 text-sm leading-relaxed text-foreground/85">
        {children}
      </div>
    </article>
  );
}

function Fase1() {
  return (
    <main className="mx-auto max-w-3xl px-6 pt-16 pb-24">
      {/* Header */}
      <p className="text-sm uppercase tracking-[0.2em] text-accent">Fase 01 · Problem Discovery</p>
      <h1 className="mt-4 font-serif text-5xl leading-tight text-foreground">
        Descoberta do problema
      </h1>
      <p className="mt-6 text-lg text-muted-foreground">
        Entender profundamente <em>o que</em> precisa ser resolvido antes de decidir <em>como</em>.
        Base: Design Thinking, Human Centered Design (IDEO), Lean Startup e Double Diamond.
      </p>

      {/* 1. Problem statement */}
      <Section eyebrow="1.1" title="Definição do problema">
        <p>
          Pessoas que usam cartão de crédito e têm renda variável ou múltiplos compromissos
          fixos <strong>não conseguem responder em tempo real</strong> à pergunta mais básica
          antes de uma compra: <em>“posso gastar isso agora sem me atrapalhar depois?”</em>.
        </p>
        <p>
          Os apps existentes mostram <strong>o passado</strong> (extrato, categorias, gráficos
          de gastos). O que falta é uma <strong>projeção viva</strong> que considere salário
          previsto, contas fixas, parcelas em aberto, datas de fechamento e vencimento dos
          cartões e o orçamento do mês — e devolva um número acionável.
        </p>
        <blockquote className="border-l-2 border-accent pl-4 font-serif text-xl text-foreground">
          Como podemos ajudar uma pessoa a decidir, no momento da compra, quanto ela
          realmente pode gastar sem comprometer seu orçamento futuro?
        </blockquote>
      </Section>

      {/* 2. Personas */}
      <Section eyebrow="1.2" title="Personas">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Marina, 29" subtitle="Analista de marketing · CLT · 2 cartões">
            <p>
              Salário fixo, mas parcela viagens e eletrônicos. Nunca sabe se pode passar mais
              R$ 300 no cartão sem estourar a próxima fatura.
            </p>
            <p className="text-muted-foreground">
              Dor principal: <em>ansiedade de fechamento de fatura</em>.
            </p>
          </Card>
          <Card title="Rafael, 34" subtitle="Freelancer de tecnologia · renda variável">
            <p>
              Meses bons e ruins. Mistura PJ, poupança e cartão. Precisa saber quanto sobra
              real antes de reservar viagem ou upgrade de equipamento.
            </p>
            <p className="text-muted-foreground">Dor principal: <em>previsibilidade</em>.</p>
          </Card>
          <Card title="Juliana, 41" subtitle="Mãe, dois filhos · orçamento familiar">
            <p>
              Divide contas com o parceiro, tem cartões adicionais e mensalidades escolares.
              Quer saber se pode antecipar um gasto sem impactar a fatura seguinte.
            </p>
            <p className="text-muted-foreground">Dor principal: <em>orçamento compartilhado</em>.</p>
          </Card>
          <Card title="Diego, 24" subtitle="Primeiro emprego · aprendendo a usar cartão">
            <p>
              Usa cartão pela primeira vez e não entende bem o ciclo fechamento/vencimento.
              Quer regras claras, não planilhas.
            </p>
            <p className="text-muted-foreground">Dor principal: <em>educação financeira aplicada</em>.</p>
          </Card>
        </div>
      </Section>

      {/* 3. Stakeholders */}
      <Section eyebrow="1.3" title="Stakeholders">
        <ul className="list-disc space-y-2 pl-6">
          <li><strong>Usuário final</strong> — quem toma a decisão de compra.</li>
          <li><strong>Parceiro / cônjuge</strong> — coautor do orçamento em muitos casos.</li>
          <li><strong>Emissores de cartão</strong> — definem datas de fechamento e vencimento.</li>
          <li><strong>Instituições financeiras</strong> — fonte de dados via Open Finance no futuro.</li>
          <li><strong>Autor do case</strong> — dono do produto, engenheiro e “usuário-zero”.</li>
          <li><strong>Comunidade LinkedIn</strong> — audiência do case, feedback e validação.</li>
        </ul>
      </Section>

      {/* 4. Journey */}
      <Section eyebrow="1.4" title="Jornada do usuário (situação atual)">
        <ol className="space-y-4">
          {[
            ["Gatilho", "Usuário está prestes a fazer uma compra (loja, restaurante, viagem)."],
            ["Dúvida", "‘Será que posso? Já gastei muito esse mês?’"],
            ["Consulta", "Abre app do banco, olha limite disponível — número enganoso porque ignora fatura em aberto."],
            ["Cálculo mental", "Tenta lembrar de parcelas, contas fixas, salário; erra ou desiste."],
            ["Decisão", "Compra por impulso ou desiste com sensação de restrição sem base."],
            ["Consequência", "Fatura chega maior do que o esperado; frustração, culpa, retrabalho."],
          ].map(([step, desc], i) => (
            <li key={i} className="flex gap-4">
              <span className="font-serif text-2xl text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <p className="font-medium text-foreground">{step}</p>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* 5. Pains */}
      <Section eyebrow="1.5" title="Dores">
        <ul className="list-disc space-y-2 pl-6">
          <li>Limite disponível do cartão mente — não desconta parcelas nem fatura em aberto.</li>
          <li>Nenhum app considera <strong>data de fechamento</strong> ao projetar impacto.</li>
          <li>Orçamento é definido no início do mês e nunca mais revisitado.</li>
          <li>Não existe resposta rápida no momento da compra — só relatórios depois.</li>
          <li>Renda variável quebra qualquer planilha estática.</li>
          <li>Falta simulação: <em>“e se eu adiar essa compra para depois do fechamento?”</em></li>
        </ul>
      </Section>

      {/* 6. Goals */}
      <Section eyebrow="1.6" title="Objetivos">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Do usuário">
            <ul className="list-disc space-y-1 pl-5">
              <li>Saber, agora, quanto pode gastar sem se comprometer.</li>
              <li>Reduzir ansiedade nas semanas próximas do fechamento.</li>
              <li>Simular decisões antes de tomá-las.</li>
              <li>Chegar no fim do mês sem sustos.</li>
            </ul>
          </Card>
          <Card title="Do produto">
            <ul className="list-disc space-y-1 pl-5">
              <li>Devolver 1 número claro em menos de 2 segundos.</li>
              <li>Modelar corretamente ciclos de cartão (fechamento/vencimento).</li>
              <li>Ser um <em>assistente de decisão</em>, não mais um extrato.</li>
              <li>Servir de case reprodutível de engenharia de software.</li>
            </ul>
          </Card>
        </div>
      </Section>

      {/* 7. LinkedIn draft */}
      <Section eyebrow="1.7" title="Rascunho do post no LinkedIn">
        <div className="rounded-lg border border-border bg-parchment p-6 font-sans text-[15px] leading-relaxed text-foreground/90">
          <p>
            Comecei um projeto para resolver um problema que me incomoda há anos: nunca
            consegui responder, no momento da compra, quanto eu realmente posso gastar no
            cartão de crédito considerando salário, contas fixas, parcelas em aberto e as
            datas de fechamento das faturas.
          </p>
          <p className="mt-3">
            Todos os apps financeiros que testei mostram muito bem <em>quanto eu já gastei</em>.
            Nenhum me diz, de forma acionável, <em>quanto eu ainda posso gastar sem me
            atrapalhar no próximo mês</em>.
          </p>
          <p className="mt-3">
            Vou construir esse produto em público, fase por fase, seguindo boas práticas de
            Product Management, UX, Engenharia de Software e Arquitetura de Sistemas —
            começando por Descoberta do Problema (Design Thinking + Double Diamond) e indo
            até deploy, testes e evolução.
          </p>
          <p className="mt-3">
            Hoje concluí a <strong>Fase 1 — Descoberta do problema</strong>: definição do
            problema, personas, stakeholders, jornada, dores e objetivos.
          </p>
          <p className="mt-3 text-muted-foreground">
            Próxima parada: pesquisa de mercado e benchmark (Mobills, Organizze, YNAB, Copilot
            Money, Monarch Money).
          </p>
        </div>
      </Section>

      {/* Nav */}
      <div className="mt-16 flex items-center justify-between border-t border-border pt-8">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Roadmap
        </Link>
        <span className="text-sm text-muted-foreground">Próxima: Fase 2 — Pesquisa</span>
      </div>
    </main>
  );
}
