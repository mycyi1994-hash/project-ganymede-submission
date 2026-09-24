"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  z: number;
  startX: number;
  startY: number;
  delay: number;
  glyph: number;
  kind: "moon" | "ring";
  surface?: boolean;
  ringBand?: number;
  orbitAngle?: number;
  orbitRadius?: number;
};

const GLYPHS = [".", ":", "+", "*", "0", "1", "/", "=", "-", "|"];
const RING_TILT = 0.36;
const RING_ROLL = -Math.PI / 4;
const SPACECRAFT_COUNT = 10;
const SPACECRAFT = [
  ["  /\\  ", "<|===>", "  \\/  "],
  ["  .  ", "=[+]=", " /_\\ "],
  ["<<o>>", " /|\\ "],
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOutExpo(value: number) {
  return value === 1 ? 1 : 1 - Math.pow(2, -10 * value);
}

function rotatePoint(x: number, y: number, z: number, angle: number) {
  const cosY = Math.cos(angle);
  const sinY = Math.sin(angle);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;
  const tilt = -0.13;
  const cosX = Math.cos(tilt);
  const sinX = Math.sin(tilt);

  return {
    x: x1,
    y: y * cosX - z1 * sinX,
    z: y * sinX + z1 * cosX,
  };
}

function rollPoint(point: { x: number; y: number; z: number }, angle: number) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
    z: point.z,
  };
}

function makeParticles(width: number, height: number) {
  const particles: Particle[] = [];
  const moonCount = width < 640 ? 6480 : 11160;
  const ringCount = width < 640 ? 3420 : 5760;
  const surfaceCount = Math.floor(moonCount * 0.42);

  for (let i = 0; i < moonCount; i += 1) {
    const surface = i < surfaceCount;
    const pointIndex = surface ? i : i - surfaceCount;
    const pointCount = surface ? surfaceCount : moonCount - surfaceCount;
    const y = 1 - ((pointIndex + 0.5) / pointCount) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = Math.PI * (3 - Math.sqrt(5)) * pointIndex + (surface ? 0 : 1.7);
    const randomRadius = Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1;
    const relief = surface
      ? 0.985 + randomRadius * 0.018
      : 0.12 + Math.cbrt(randomRadius) * 0.79;

    particles.push({
      x: Math.cos(theta) * radius * relief,
      y: y * relief,
      z: Math.sin(theta) * radius * relief,
      startX: 0,
      startY: 0,
      delay: Math.random() * 1050,
      glyph: i % GLYPHS.length,
      kind: "moon",
      surface,
    });
  }

  for (let i = 0; i < ringCount; i += 1) {
    const ringIndex = i % 3;
    const pointIndex = Math.floor(i / 3);
    const pointCount = Math.ceil((ringCount - ringIndex) / 3);
    const angle = (pointIndex / pointCount) * Math.PI * 2 + ringIndex * 0.17;
    const strand = (pointIndex % 5) - 2;
    const band = [1.3, 1.52, 1.78][ringIndex]
      + strand * 0.006
      + Math.sin(i * 2.1) * 0.002;
    const x = Math.cos(angle) * band;
    const z = Math.sin(angle) * band;

    particles.push({
      x,
      y: -z * Math.sin(RING_TILT),
      z: z * Math.cos(RING_TILT),
      startX: 0,
      startY: 0,
      delay: 450 + Math.random() * 1250,
      glyph: (i + 3) % GLYPHS.length,
      kind: "ring",
      ringBand: ringIndex,
      orbitAngle: angle,
      orbitRadius: band,
    });
  }

  particles.forEach((particle, index) => {
    const edge = index % 4;
    const margin = 50 + Math.random() * 180;
    if (edge === 0) {
      particle.startX = -margin;
      particle.startY = Math.random() * height;
    } else if (edge === 1) {
      particle.startX = width + margin;
      particle.startY = Math.random() * height;
    } else if (edge === 2) {
      particle.startX = Math.random() * width;
      particle.startY = -margin;
    } else {
      particle.startX = Math.random() * width;
      particle.startY = height + margin;
    }
  });

  return particles;
}

function makeGlyphAtlas(fontSize: number) {
  const levels = 6;
  const cell = Math.max(8, Math.ceil(fontSize * 1.65));
  const atlas = document.createElement("canvas");
  const atlasContext = atlas.getContext("2d");
  atlas.width = cell * GLYPHS.length;
  atlas.height = cell * levels;

  if (atlasContext) {
    atlasContext.textAlign = "center";
    atlasContext.textBaseline = "middle";
    atlasContext.fillStyle = "#f3f3ee";
    atlasContext.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

    for (let level = 0; level < levels; level += 1) {
      atlasContext.globalAlpha = ((level + 1) / levels) * 0.96;
      GLYPHS.forEach((glyph, index) => {
        atlasContext.fillText(glyph, index * cell + cell / 2, level * cell + cell / 2);
      });
    }
  }

  return { atlas, cell, levels };
}

function drawSpacecraft(
  context: CanvasRenderingContext2D,
  model: string[],
  x: number,
  y: number,
  rotation: number,
  scale: number,
  alpha: number,
) {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(scale, scale);
  context.globalAlpha = alpha;
  context.fillStyle = "#f5f5ef";
  context.font = "9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  model.forEach((line, index) => {
    context.fillText(line, 0, (index - (model.length - 1) / 2) * 9);
  });
  context.restore();
}

export default function GanymedeScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let moonParticles: Particle[] = [];
    let ringParticles: Particle[] = [];
    let glyphAtlas = makeGlyphAtlas(6);
    let start = performance.now();
    let lastFrame = 0;
    let pageVisible = !document.hidden;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const particles = makeParticles(width, height);
      moonParticles = particles.filter((particle) => particle.kind === "moon");
      ringParticles = particles.filter((particle) => particle.kind === "ring");
      glyphAtlas = makeGlyphAtlas(Math.max(4.8, Math.min(7.2, width / 220)));
      start = performance.now();
      lastFrame = 0;
    };

    const draw = (now: number) => {
      if (!pageVisible) {
        animationFrame = requestAnimationFrame(draw);
        return;
      }
      if (!reduceMotion && now - lastFrame < 32) {
        animationFrame = requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;

      const elapsed = reduceMotion ? 5000 : now - start;
      const angle = reduceMotion ? 0.38 : elapsed * 0.000068;
      const centerX = width * 0.5;
      const centerY = height * (width < 640 ? 0.4 : 0.41);
      const sceneScale = Math.min(width, height) * (width < 640 ? 0.18 : 0.195);

      context.clearRect(0, 0, width, height);
      context.globalAlpha = 1;

      const drawParticle = (particle: Particle, index: number, layer: "back" | "moon" | "front") => {
        let rotated;

        if (particle.kind === "ring") {
          const orbitAngle = (particle.orbitAngle ?? 0) + elapsed * 0.000035;
          const orbitRadius = particle.orbitRadius ?? 1.6;
          const ringX = Math.cos(orbitAngle) * orbitRadius;
          const ringZ = Math.sin(orbitAngle) * orbitRadius;
          rotated = rollPoint(
            rotatePoint(
              ringX,
              -ringZ * Math.sin(RING_TILT),
              ringZ * Math.cos(RING_TILT),
              0,
            ),
            RING_ROLL,
          );

          if (layer === "back" && rotated.z >= 0) return;
          if (layer === "front" && rotated.z < 0) return;
        } else {
          rotated = rotatePoint(particle.x, particle.y, particle.z, angle);
        }

        const perspective = 1 / (1.02 - rotated.z * 0.12);
        const targetX = centerX + rotated.x * sceneScale * perspective;
        const targetY = centerY + rotated.y * sceneScale * perspective;
        if (
          particle.kind === "ring"
          && layer === "back"
          && Math.hypot(targetX - centerX, targetY - centerY) < sceneScale * 1.01
        ) return;
        const localProgress = reduceMotion
          ? 1
          : clamp((elapsed - particle.delay) / (particle.kind === "ring" ? 2100 : 2500));
        const eased = easeOutExpo(localProgress);
        const swirl = Math.sin(elapsed * 0.002 + index * 0.37) * 22 * (1 - eased);
        const x = particle.startX + (targetX - particle.startX) * eased + swirl;
        const y = particle.startY + (targetY - particle.startY) * eased + Math.cos(index) * swirl;
        const ringWeight = [0.68, 1, 0.76][particle.ringBand ?? 0];
        const depthAlpha = particle.kind === "ring"
          ? ((layer === "back" ? 0.11 : 0.34) + (rotated.z + 2) * (layer === "back" ? 0.035 : 0.095)) * ringWeight
          : (particle.surface ? 0.42 : 0.2) + (rotated.z + 1) * (particle.surface ? 0.27 : 0.3);

        const alpha = clamp(localProgress * depthAlpha, 0, 0.96);
        if (alpha < 0.035) return;
        const level = Math.min(glyphAtlas.levels - 1, Math.floor(alpha * glyphAtlas.levels));
        const sourceX = particle.glyph * glyphAtlas.cell;
        const sourceY = level * glyphAtlas.cell;
        context.drawImage(
          glyphAtlas.atlas,
          sourceX,
          sourceY,
          glyphAtlas.cell,
          glyphAtlas.cell,
          x - glyphAtlas.cell / 2,
          y - glyphAtlas.cell / 2,
          glyphAtlas.cell,
          glyphAtlas.cell,
        );
      };

      ringParticles.forEach((particle, index) => drawParticle(particle, index, "back"));
      moonParticles.forEach((particle, index) => drawParticle(particle, index, "moon"));
      ringParticles.forEach((particle, index) => drawParticle(particle, index, "front"));

      for (let index = 0; index < SPACECRAFT_COUNT; index += 1) {
        const model = SPACECRAFT[index % SPACECRAFT.length];
        const direction = index % 2 === 0 ? 1 : -1;
        const speed = [0.000055, 0.00007, 0.000085, 0.0001, 0.000115][index % 5];
        const phase = (index / SPACECRAFT_COUNT) * Math.PI * 2 + (index % 3 - 1) * 0.11;
        const orbit = (2.02 + (index % 5) * 0.18) * sceneScale;
        const flattening = 0.3 + (index % 4) * 0.04;
        const orbitRoll = RING_ROLL + (index % 3 - 1) * 0.07;
        const shipAngle = elapsed * speed * direction + phase;
        const rawX = Math.cos(shipAngle) * orbit;
        const rawY = Math.sin(shipAngle) * orbit * flattening;
        const orbitX = centerX + rawX * Math.cos(orbitRoll) - rawY * Math.sin(orbitRoll);
        const orbitY = centerY + rawX * Math.sin(orbitRoll) + rawY * Math.cos(orbitRoll);
        const arrival = reduceMotion ? 1 : easeOutExpo(clamp((elapsed - 1000 - index * 120) / 1800));
        const entryEdge = index % 4;
        const startX = entryEdge === 0
          ? -110
          : entryEdge === 1
            ? width + 110
            : width * (0.18 + (index % 5) * 0.16);
        const startY = entryEdge === 2
          ? -80
          : entryEdge === 3
            ? height + 80
            : height * (0.18 + (index % 6) * 0.12);
        const x = startX + (orbitX - startX) * arrival;
        const y = startY + (orbitY - startY) * arrival;
        const rawDx = -Math.sin(shipAngle) * orbit * direction;
        const rawDy = Math.cos(shipAngle) * orbit * flattening * direction;
        const tangent = Math.atan2(
          rawDx * Math.sin(orbitRoll) + rawDy * Math.cos(orbitRoll),
          rawDx * Math.cos(orbitRoll) - rawDy * Math.sin(orbitRoll),
        );
        const depth = (Math.sin(shipAngle) + 1) * 0.5;

        drawSpacecraft(
          context,
          model,
          x,
          y,
          tangent,
          width < 640 ? 0.54 : 0.66 + depth * 0.18,
          arrival * (0.1 + depth * 0.5),
        );
      }

      context.globalAlpha = 1;
      if (!reduceMotion) animationFrame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    const handleVisibility = () => { pageVisible = !document.hidden; };
    document.addEventListener("visibilitychange", handleVisibility);
    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <div className="scene" aria-label="ASCII particles assemble into a rotating moon with orbital rings and passing spacecraft">
      <canvas ref={canvasRef} className="ascii-canvas" aria-hidden="true" />
    </div>
  );
}
