"use client";

import { GrainGradient } from "@paper-design/shaders-react";
import styles from "./page.module.css";

export function ShaderBackdrop() {
  return (
    <div className={styles.shader} aria-hidden="true">
      <GrainGradient
        colorBack="#030303"
        colors={["#f7f4ec", "#c9c7bd", "#85837a", "#3a3935", "#0b0b0a"]}
        intensity={0.42}
        noise={0.38}
        shape="wave"
        softness={0.72}
        speed={0.16}
        scale={1.08}
        rotation={4}
        offsetX={0.04}
        offsetY={-0.03}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
