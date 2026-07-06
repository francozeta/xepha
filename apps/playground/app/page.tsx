import styles from "./page.module.css";

const layers = ["core", "memory", "graph", "protocol", "adapters", "cli"] as const;

export default function Playground() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Xepha playground</p>
        <h1>Context packs before dashboards</h1>
        <p className={styles.lead}>
          This app will become the local workbench for inspecting events, graph links, and
          agent-ready context.
        </p>
        <div className={styles.grid}>
          {layers.map((layer, index) => (
            <article key={layer}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h2>{layer}</h2>
              <p>Reserved layer for the MVP intelligence pipeline.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
