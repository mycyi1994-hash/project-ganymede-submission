"use client";

import { useEffect, useRef } from "react";

export type CelestialVariant = "core" | "tech" | "income" | "alpha";

type PlanetKind = "jupiter" | "saturn" | "earth" | "mars";
type Feature = "base" | "band" | "storm" | "land" | "crater" | "cap";

type SphereParticle = {
  x: number;
  y: number;
  z: number;
  latitude: number;
  longitude: number;
  glyph: number;
  surface: boolean;
  feature: Feature;
};

type RingParticle = {
  angle: number;
  radius: number;
  glyph: number;
  band: number;
};

type Config = {
  kind: PlanetKind;
  sphereCount: number;
  ringCount: number;
  bands: number[];
  moonBands: number[];
  ringTilt: number;
  ringRoll: number;
  rotationSpeed: number;
  ringSpeed: number;
  axialTilt: number;
  scale: number;
  verticalScale: number;
  denseRings: boolean;
};

const GLYPHS = [".", ":", "+", "*", "0", "1", "/", "=", "-", "|"];

const PLANET_LABELS: Record<CelestialVariant, string> = {
  core: "JUPITER / 05",
  tech: "SATURN / 06",
  income: "EARTH / 03",
  alpha: "MARS / 04",
};

const PRODUCT_GLYPH_COLORS: Record<CelestialVariant, string> = {
  core: "#c9d8e1",
  tech: "#d0c0e2",
  income: "#c7d8cb",
  alpha: "#ddb9aa",
};

const CONFIGS: Record<CelestialVariant, Config> = {
  core: {
    kind: "jupiter",
    sphereCount: 2180,
    ringCount: 360,
    bands: [1.38, 1.67, 1.98, 2.3],
    moonBands: [1.38, 1.67, 1.98, 2.3],
    ringTilt: 0.12,
    ringRoll: -0.08,
    rotationSpeed: 0.0002,
    ringSpeed: 0.000045,
    axialTilt: -0.06,
    scale: 0.39,
    verticalScale: 0.91,
    denseRings: false,
  },
  tech: {
    kind: "saturn",
    sphereCount: 1420,
    ringCount: 1960,
    bands: [1.28, 1.36, 1.47, 1.59, 1.72, 1.88, 2.04, 2.18],
    moonBands: [2.33],
    ringTilt: 0.27,
    ringRoll: -0.34,
    rotationSpeed: -0.00024,
    ringSpeed: 0.00007,
    axialTilt: 0.08,
    scale: 0.35,
    verticalScale: 0.9,
    denseRings: true,
  },
  income: {
    kind: "earth",
    sphereCount: 2040,
    ringCount: 150,
    bands: [1.62],
    moonBands: [1.62],
    ringTilt: 0.66,
    ringRoll: -0.18,
    rotationSpeed: 0.00017,
    ringSpeed: 0.00006,
    axialTilt: -0.23,
    scale: 0.4,
    verticalScale: 1,
    denseRings: false,
  },
  alpha: {
    kind: "mars",
    sphereCount: 1720,
    ringCount: 190,
    bands: [1.34, 1.72],
    moonBands: [1.34, 1.72],
    ringTilt: 0.88,
    ringRoll: 0.2,
    rotationSpeed: 0.00031,
    ringSpeed: 0.00011,
    axialTilt: 0.2,
    scale: 0.38,
    verticalScale: 0.98,
    denseRings: false,
  },
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hash(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function angularDistance(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function inBlob(longitude: number, latitude: number, centerLongitude: number, centerLatitude: number, width: number, height: number) {
  const dx = angularDistance(longitude, centerLongitude) / width;
  const dy = Math.abs(latitude - centerLatitude) / height;
  return dx * dx + dy * dy < 1;
}

function earthLand(longitude: number, latitude: number) {
  return (
    inBlob(longitude, latitude, -2.15, 0.55, 0.48, 0.36) ||
    inBlob(longitude, latitude, -1.9, 0.15, 0.35, 0.58) ||
    inBlob(longitude, latitude, -1.35, -0.52, 0.26, 0.46) ||
    inBlob(longitude, latitude, 0.28, 0.52, 0.76, 0.38) ||
    inBlob(longitude, latitude, 0.48, 0.02, 0.46, 0.62) ||
    inBlob(longitude, latitude, 1.18, 0.45, 0.62, 0.35) ||
    inBlob(longitude, latitude, 2.22, -0.48, 0.34, 0.25)
  );
}

function marsFeature(longitude: number, latitude: number) {
  const craters = [
    [-1.35, 0.18, 0.22],
    [0.55, -0.28, 0.3],
    [2.1, 0.38, 0.18],
    [-2.45, -0.42, 0.16],
  ];

  for (const [centerLongitude, centerLatitude, radius] of craters) {
    const dx = angularDistance(longitude, centerLongitude) * Math.cos(latitude);
    const dy = latitude - centerLatitude;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (Math.abs(distance - radius) < 0.04 || distance < radius * 0.35) return "crater" as const;
  }

  if (Math.abs(latitude) > 1.2) return "cap" as const;
  return "base" as const;
}

function getFeature(kind: PlanetKind, longitude: number, latitude: number): Feature {
  if (kind === "jupiter") {
    if (inBlob(longitude, latitude, 0.55, -0.3, 0.38, 0.13)) return "storm";
    return Math.abs(Math.sin(latitude * 13)) > 0.46 ? "band" : "base";
  }

  if (kind === "saturn") return Math.abs(Math.sin(latitude * 11)) > 0.68 ? "band" : "base";
  if (kind === "earth") return earthLand(longitude, latitude) ? "land" : "base";
  return marsFeature(longitude, latitude);
}

function rotateSphere(x: number, y: number, z: number, yaw: number, tilt: number) {
  const cosineY = Math.cos(yaw);
  const sineY = Math.sin(yaw);
  const rotatedX = x * cosineY - z * sineY;
  const rotatedZ = x * sineY + z * cosineY;
  const cosineX = Math.cos(tilt);
  const sineX = Math.sin(tilt);

  return {
    x: rotatedX,
    y: y * cosineX - rotatedZ * sineX,
    z: y * sineX + rotatedZ * cosineX,
  };
}

function rollPoint(point: { x: number; y: number; z: number }, roll: number) {
  const cosine = Math.cos(roll);
  const sine = Math.sin(roll);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
    z: point.z,
  };
}

function makeSphere(count: number, config: Config) {
  const particles: SphereParticle[] = [];
  const surfaceCount = Math.floor(count * 0.64);

  for (let index = 0; index < count; index += 1) {
    const surface = index < surfaceCount;
    const localIndex = surface ? index : index - surfaceCount;
    const localCount = surface ? surfaceCount : count - surfaceCount;
    const normalizedY = 1 - ((localIndex + 0.5) / localCount) * 2;
    const latitude = Math.asin(normalizedY);
    const latitudeRadius = Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
    const longitude = Math.PI * (3 - Math.sqrt(5)) * localIndex + (surface ? 0 : 1.37);
    const randomRadius = hash(index + 11);
    const relief = surface ? 0.975 + randomRadius * 0.025 : 0.18 + Math.cbrt(randomRadius) * 0.72;
    const feature = surface ? getFeature(config.kind, longitude, latitude) : "base";
    let glyph = index % GLYPHS.length;

    if (feature === "band") glyph = index % 2 ? 8 : 7;
    if (feature === "storm") glyph = index % 3 ? 4 : 6;
    if (feature === "land") glyph = index % 3 ? 3 : 2;
    if (feature === "crater") glyph = index % 2 ? 4 : 0;
    if (feature === "cap") glyph = index % 2 ? 7 : 3;

    particles.push({
      x: Math.cos(longitude) * latitudeRadius * relief,
      y: normalizedY * relief * config.verticalScale,
      z: Math.sin(longitude) * latitudeRadius * relief,
      latitude,
      longitude,
      glyph,
      surface,
      feature,
    });
  }

  return particles;
}

function makeRings(count: number, bands: number[], dense: boolean) {
  const particles: RingParticle[] = [];

  for (let index = 0; index < count; index += 1) {
    const band = index % bands.length;
    const localIndex = Math.floor(index / bands.length);
    const localCount = Math.ceil((count - band) / bands.length);
    const strand = dense ? (localIndex % 5) - 2 : 0;
    particles.push({
      angle: (localIndex / localCount) * Math.PI * 2 + band * 0.14,
      radius: bands[band] + strand * 0.006 + Math.sin(index * 1.7) * 0.002,
      glyph: dense ? [0, 8, 7, 1][index % 4] : index % 4 === 0 ? 8 : 0,
      band,
    });
  }

  return particles;
}

function makeGlyphAtlas(fontSize: number, color: string) {
  const levels = 7;
  const cell = Math.max(7, Math.ceil(fontSize * 1.65));
  const atlas = document.createElement("canvas");
  const context = atlas.getContext("2d");
  atlas.width = cell * GLYPHS.length;
  atlas.height = cell * levels;

  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    for (let level = 0; level < levels; level += 1) {
      context.globalAlpha = ((level + 1) / levels) * 0.96;
      GLYPHS.forEach((glyph, index) => {
        context.fillText(glyph, index * cell + cell / 2, level * cell + cell / 2);
      });
    }
  }

  return { atlas, cell, levels };
}

function featureAlpha(feature: Feature) {
  if (feature === "storm") return 0.24;
  if (feature === "land") return 0.2;
  if (feature === "band") return 0.13;
  if (feature === "crater" || feature === "cap") return 0.18;
  return 0;
}

export default function MiniAsciiCelestial({ variant }: { variant: CelestialVariant }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const config = CONFIGS[variant];
    const sphere = makeSphere(config.sphereCount, config);
    const rings = makeRings(config.ringCount, config.bands, config.denseRings);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let glyphAtlas = makeGlyphAtlas(5.8, PRODUCT_GLYPH_COLORS[variant]);
    let animationFrame = 0;
    let resizeFrame = 0;
    let lastFrame = 0;
    let visible = true;
    let pageVisible = !document.hidden;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      glyphAtlas = makeGlyphAtlas(clamp(Math.min(width, height) / 34, 4.8, 6.8), PRODUCT_GLYPH_COLORS[variant]);
    };

    const drawGlyph = (glyph: number, x: number, y: number, alpha: number, size = 1) => {
      if (alpha < 0.035) return;
      const level = Math.min(glyphAtlas.levels - 1, Math.floor(clamp(alpha) * glyphAtlas.levels));
      const destinationSize = glyphAtlas.cell * size;
      context.drawImage(
        glyphAtlas.atlas,
        glyph * glyphAtlas.cell,
        level * glyphAtlas.cell,
        glyphAtlas.cell,
        glyphAtlas.cell,
        x - destinationSize / 2,
        y - destinationSize / 2,
        destinationSize,
        destinationSize,
      );
    };

    const draw = (now: number) => {
      animationFrame = requestAnimationFrame(draw);
      if (!visible || !pageVisible || (!reduceMotion && now - lastFrame < 40)) return;
      lastFrame = now;

      const elapsed = reduceMotion ? 3200 : now;
      const yaw = elapsed * config.rotationSpeed;
      const centerX = width * 0.5;
      const centerY = height * 0.49;
      const scale = Math.min(width, height) * config.scale;
      context.clearRect(0, 0, width, height);

      const variantSeed = ({ core: 17, tech: 31, income: 47, alpha: 61 } as const)[variant];

      const drawAmbientField = () => {
        for (let index = 0; index < 42; index += 1) {
          const x = hash(index * 3 + variantSeed) * width;
          const y = hash(index * 7 + variantSeed + 9) * height;
          const distance = Math.hypot((x - centerX) / Math.max(width, 1), (y - centerY) / Math.max(height, 1));
          if (distance < 0.22) continue;
          const pulse = reduceMotion ? 0.5 : 0.42 + Math.sin(elapsed * 0.0012 + index) * 0.18;
          drawGlyph(index % 9 === 0 ? 2 : 0, x, y, 0.08 + pulse * 0.13, index % 13 === 0 ? 1.15 : 0.78);
        }
      };

      const drawComet = () => {
        const travel = reduceMotion ? 0.58 : (elapsed * 0.000032 + variantSeed * 0.017) % 1;
        const headX = width * (1.16 - travel * 1.42);
        const headY = height * (0.13 + travel * 0.38) + Math.sin(elapsed * 0.0005 + variantSeed) * height * 0.025;
        for (let tail = 12; tail >= 0; tail -= 1) {
          drawGlyph(
            tail === 0 ? 3 : tail % 3 === 0 ? 8 : 0,
            headX + tail * Math.max(3.7, width * 0.009),
            headY - tail * Math.max(1.25, height * 0.006),
            tail === 0 ? 0.75 : 0.34 * (1 - tail / 13),
            tail === 0 ? 1.2 : 0.72,
          );
        }
      };

      const drawSpacecraft = (index: number) => {
        const direction = index === 0 ? 1 : -1;
        const angle = elapsed * (0.00011 + index * 0.000025) * direction + variantSeed * 0.08 + index * Math.PI;
        const orbitX = width * (0.38 + index * 0.05);
        const orbitY = height * (0.3 + index * 0.035);
        const x = centerX + Math.cos(angle) * orbitX;
        const y = centerY + Math.sin(angle) * orbitY;
        const facing = Math.cos(angle) >= 0 ? 1 : -1;
        drawGlyph(6, x - 6 * facing, y, 0.62, 0.85);
        drawGlyph(7, x, y, 0.74, 0.9);
        drawGlyph(6, x + 6 * facing, y, 0.62, 0.85);
        drawGlyph(2, x - 11 * facing, y + 1, 0.32, 0.72);
      };

      drawAmbientField();
      drawComet();

      const projectRing = (particle: RingParticle | { angle: number; radius: number }) => {
        const angle = particle.angle + elapsed * config.ringSpeed;
        const x = Math.cos(angle) * particle.radius;
        const z = Math.sin(angle) * particle.radius;
        return rollPoint({
          x,
          y: -z * Math.sin(config.ringTilt),
          z: z * Math.cos(config.ringTilt),
        }, config.ringRoll);
      };

      const drawRingLayer = (front: boolean) => {
        rings.forEach((particle) => {
          const point = projectRing(particle);
          if (front ? point.z < 0 : point.z >= 0) return;
          const perspective = 1 / (1.08 - point.z * 0.09);
          const x = centerX + point.x * scale * perspective;
          const y = centerY + point.y * scale * perspective;
          const base = config.denseRings ? (front ? 0.54 : 0.2) : (front ? 0.24 : 0.09);
          const depth = config.denseRings ? point.z * 0.1 : point.z * 0.035;
          const bandWeight = config.denseRings ? 0.72 + particle.band * 0.045 : 1;
          drawGlyph(particle.glyph, x, y, (base + depth) * bandWeight);
        });
      };

      const drawMoonLayer = (front: boolean) => {
        config.moonBands.forEach((radius, index) => {
          const phase = [0.22, 1.72, 3.02, 4.35][index % 4];
          const point = projectRing({ angle: phase, radius });
          if (front ? point.z < 0 : point.z >= 0) return;
          const perspective = 1 / (1.08 - point.z * 0.09);
          const x = centerX + point.x * scale * perspective;
          const y = centerY + point.y * scale * perspective;
          const moonSize = config.kind === "earth" ? 1.65 : config.kind === "jupiter" ? 1.15 + index * 0.08 : 1.05;
          const alpha = front ? 0.9 : 0.34;
          drawGlyph(index % 2 ? 3 : 4, x, y, alpha, moonSize);
          if (moonSize > 1.4) {
            drawGlyph(0, x - 4, y + 2, alpha * 0.55);
            drawGlyph(0, x + 3, y - 3, alpha * 0.55);
          }
        });
      };

      drawRingLayer(false);
      drawMoonLayer(false);

      sphere.forEach((particle) => {
        const point = rotateSphere(particle.x, particle.y, particle.z, yaw, config.axialTilt);
        const perspective = 1 / (1.04 - point.z * 0.12);
        const x = centerX + point.x * scale * perspective;
        const y = centerY + point.y * scale * perspective;
        const limb = clamp((point.z + 1.05) / 2.05);
        let alpha = particle.surface ? 0.36 + limb * 0.42 : 0.1 + limb * 0.22;
        alpha += particle.surface ? featureAlpha(particle.feature) : 0;
        if (config.kind === "jupiter" && particle.feature === "base") alpha *= 0.82 + Math.abs(Math.sin(particle.latitude * 13)) * 0.18;
        if (config.kind === "earth" && particle.feature === "base") alpha *= 0.72;
        if (config.kind === "mars" && particle.surface) alpha *= 0.78 + hash(particle.glyph + Math.round(particle.longitude * 100)) * 0.22;
        drawGlyph(particle.glyph, x, y, alpha);
      });

      drawRingLayer(true);
      drawMoonLayer(true);
      drawSpacecraft(0);
      drawSpacecraft(1);

      if (reduceMotion) cancelAnimationFrame(animationFrame);
    };

    const scheduleResize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(resize);
    };
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(canvas);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    }, { rootMargin: "100px" });
    visibilityObserver.observe(canvas);
    const handleVisibility = () => { pageVisible = !document.hidden; };
    document.addEventListener("visibilitychange", handleVisibility);

    resize();
    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [variant]);

  return (
    <>
      <canvas ref={canvasRef} className="mini-ascii-celestial" aria-hidden="true" />
      <span className="celestial-id" aria-hidden="true">{PLANET_LABELS[variant]}</span>
    </>
  );
}
