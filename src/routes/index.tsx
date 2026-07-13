import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
});

const phases = [
  { n: "01", title: "Descoberta do problema", status: "Concluído", href: "/fase-1" as const },
  { n: "02", title: "Pesquisa e benchmark", status: "A fazer" },
  { n: "03", title: "Engenharia de requisitos", status: "A fazer" },
  { n: "04", title: "Modelagem do negócio", status: "A fazer" },
  { n: "05", title: "Modelagem UML", status: "A fazer" },
  { n: "06", title: "Arquitetura do sistema", status: "A fazer" },
  { n: "07", title: "Modelagem do banco", status: "A fazer" },
  { n: "08", title: "UX/UI e protótipo", status: "A fazer" },
  { n: "09", title: "System design", status: "A fazer" },
  { n: "10", title: "Desenvolvimento", status: "A fazer" },
  { n: "11", title: "Testes", status: "A fazer" },
  { n: "12", title: "Deploy", status: "A fazer" },
  { n: "13", title: "Evolução", status: "A fazer" },
];

function Index() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16">
        <p className="text-sm uppercase tracking-[0.2em] text-accent">
          Case público · Product + UX + Engenharia
        </p>
        <h1 className="mt-6 font-serif text-5xl leading-[1.05] text-foreground sm:text-6xl md:text-7xl">
          Quanto posso gastar hoje{" "}
          <em className="text-accent">sem comprometer</em> meu orçamento futuro?
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          A maioria dos apps financeiros mostra quanto você <em>já gastou</em>. Este projeto
          nasce para responder a pergunta que realmente importa antes de passar o cartão —
          e vai ser construído em público, fase a fase, seguindo boas práticas de Design
          Thinking, Engenharia de Requisitos, UML, Clean Architecture e System Design.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/app"
            className="inline-flex items-center rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Ver MVP funcional →
          </Link>
          <Link
            to="/fase-1"
            className="inline-flex items-center rounded-md border border-input px-5 py-3 text-sm font-medium text-foreground hover:bg-secondary"
          >
            Ler a Fase 1
          </Link>
          <a
            href="#roadmap"
            className="inline-flex items-center rounded-md border border-input px-5 py-3 text-sm font-medium text-foreground hover:bg-secondary"
          >
            Ver roadmap completo
          </a>
        </div>
      </section>

      {/* Diferencial */}
      <section className="border-y border-border/70 bg-card">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 md:grid-cols-3">
          <div>
            <p className="font-serif text-3xl text-foreground">Registrar</p>
            <p className="mt-2 text-sm text-muted-foreground">
              O que os apps atuais fazem: mostrar o passado.
            </p>
          </div>
          <div>
            <p className="font-serif text-3xl text-foreground">Projetar</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Considerar salário, contas fixas, parcelas, fechamento e vencimento de cartões.
            </p>
          </div>
          <div>
            <p className="font-serif text-3xl text-accent">Decidir</p>
            <p className="mt-2 text-sm text-muted-foreground">
              “Você pode gastar R$ 842,15 neste cartão até o fechamento.” Assistente de decisão.
            </p>
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section id="roadmap" className="mx-auto max-w-5xl px-6 py-20">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-accent">Roadmap</p>
            <h2 className="mt-2 font-serif text-4xl text-foreground">13 fases, em público</h2>
          </div>
          <p className="hidden max-w-xs text-sm text-muted-foreground md:block">
            Cada fase vira um artefato aqui + um post no LinkedIn.
          </p>
        </div>

        <ol className="divide-y divide-border border-y border-border">
          {phases.map((p) => {
            const inner = (
              <div className="flex items-center justify-between gap-6 py-5">
                <div className="flex items-baseline gap-6">
                  <span className="font-serif text-2xl text-muted-foreground">{p.n}</span>
                  <span className="text-lg text-foreground">{p.title}</span>
                </div>
                <span
                  className={
                    "text-xs uppercase tracking-widest " +
                    (p.status === "Em andamento"
                      ? "text-accent"
                      : "text-muted-foreground")
                  }
                >
                  {p.status}
                </span>
              </div>
            );
            return (
              <li key={p.n}>
                {p.href ? (
                  <Link to={p.href} className="block transition-colors hover:bg-secondary/60 px-2 -mx-2 rounded">
                    {inner}
                  </Link>
                ) : (
                  <div className="px-2 -mx-2 opacity-70">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
