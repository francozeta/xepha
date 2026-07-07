import { ShaderBackdrop } from "./shader-backdrop";
import styles from "./page.module.css";

const description = "Local memory for project history, decisions, and context.";

export default function Home() {
  return (
    <main className={styles.page}>
      <ShaderBackdrop />
      <div className={styles.vignette} aria-hidden="true" />
      <section className={styles.hero} aria-labelledby="hero-title">
        <h1 id="hero-title">Xepha</h1>
        <p>{description}</p>
        <div className={styles.actions}>
          <span className={styles.status}>Coming soon</span>
          <a
            className={styles.githubButton}
            href="https://github.com/francozeta/xepha"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
        </div>
      </section>
      <p className={styles.credit}>
        made by{" "}
        <a href="https://github.com/francozeta" rel="noreferrer" target="_blank">
          francozeta
        </a>
      </p>
    </main>
  );
}
