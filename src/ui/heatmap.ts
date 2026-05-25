import { FLOOR_RAW } from '../data/floor';

export function heatmapColor(avgDmg: number, alpha?: number): string {
  if (Number.isNaN(avgDmg) || avgDmg === null) return `rgba(40,40,40,${alpha ?? 0.6})`;
  if (avgDmg < 0) avgDmg = 0;
  const a = alpha ?? 1;
  if (avgDmg >= 80) return `rgba(0,0,0,${a})`;
  let r: number, g: number, b: number;
  // Target bands: 0-20 green, 21-26 green/yellow, 27-39 yellow,
  // 40-50 orange, 51-60 red, 61+ dark red/black.
  if (avgDmg <= 20) {
    const t = avgDmg / 20;
    r = Math.floor(25 + t * 65);
    g = Math.floor(175 + t * 45);
    b = Math.floor(35 - t * 10);
  } else if (avgDmg <= 26) {
    const t = (avgDmg - 20) / 6;
    r = Math.floor(90 + t * 140);
    g = 220;
    b = Math.floor(25 - t * 25);
  } else if (avgDmg <= 39) {
    const t = (avgDmg - 26) / 13;
    r = Math.floor(230 + t * 25);
    g = Math.floor(220 - t * 25);
    b = 0;
  } else if (avgDmg <= 50) {
    const t = (avgDmg - 39) / 11;
    r = 255;
    g = Math.floor(195 - t * 105);
    b = 0;
  } else if (avgDmg <= 60) {
    const t = (avgDmg - 50) / 10;
    r = Math.floor(255 - t * 35);
    g = Math.floor(90 - t * 90);
    b = 0;
  } else {
    const t = (avgDmg - 60) / 20;
    r = Math.floor(220 - t * 220);
    g = 0;
    b = 0;
  }
  return `rgba(${r},${g},${b},${a})`;
}

export function heatmapBlended(avgDmg: number, fx: number, fy: number, maxBlend?: number): string {
  if (avgDmg < 0) avgDmg = 0;
  let r: number, g: number, b: number;
  if (Number.isNaN(avgDmg) || avgDmg === null) {
    r = 40;
    g = 40;
    b = 40;
  } else if (avgDmg <= 20) {
    const t = avgDmg / 20;
    r = Math.floor(25 + t * 65);
    g = Math.floor(175 + t * 45);
    b = Math.floor(35 - t * 10);
  } else if (avgDmg <= 26) {
    const t = (avgDmg - 20) / 6;
    r = Math.floor(90 + t * 140);
    g = 220;
    b = Math.floor(25 - t * 25);
  } else if (avgDmg <= 39) {
    const t = (avgDmg - 26) / 13;
    r = Math.floor(230 + t * 25);
    g = Math.floor(220 - t * 25);
    b = 0;
  } else if (avgDmg <= 50) {
    const t = (avgDmg - 39) / 11;
    r = 255;
    g = Math.floor(195 - t * 105);
    b = 0;
  } else if (avgDmg <= 60) {
    const t = (avgDmg - 50) / 10;
    r = Math.floor(255 - t * 35);
    g = Math.floor(90 - t * 90);
    b = 0;
  } else if (avgDmg <= 80) {
    const t = (avgDmg - 60) / 20;
    r = Math.floor(220 - t * 220);
    g = 0;
    b = 0;
  } else {
    r = 0;
    g = 0;
    b = 0;
  }
  // For >60, blend with floor color so 51-60 remains visibly red.
  const mb = maxBlend ?? 0.8;
  if (avgDmg > 60 && FLOOR_RAW[fy] && FLOOR_RAW[fy]![fx]) {
    const blend = Math.min((avgDmg - 60) / 50, mb);
    const fc = FLOOR_RAW[fy]![fx]!;
    const fr = parseInt(fc.slice(1, 3), 16);
    const fg = parseInt(fc.slice(3, 5), 16);
    const fb = parseInt(fc.slice(5, 7), 16);
    r = Math.round(r * (1 - blend) + fr * blend);
    g = Math.round(g * (1 - blend) + fg * blend);
    b = Math.round(b * (1 - blend) + fb * blend);
  }
  return `rgb(${r},${g},${b})`;
}

export function histogramColor(dmgVal: number): string {
  if (dmgVal < 0) dmgVal = 0;
  let r: number, g: number, b: number;
  if (dmgVal <= 20) {
    const t = dmgVal / 20;
    r = Math.floor(25 + t * 65);
    g = Math.floor(175 + t * 45);
    b = Math.floor(35 - t * 10);
  } else if (dmgVal <= 26) {
    const t = (dmgVal - 20) / 6;
    r = Math.floor(90 + t * 140);
    g = 220;
    b = Math.floor(25 - t * 25);
  } else if (dmgVal <= 39) {
    const t = (dmgVal - 26) / 13;
    r = Math.floor(230 + t * 25);
    g = Math.floor(220 - t * 25);
    b = 0;
  } else if (dmgVal <= 50) {
    const t = (dmgVal - 39) / 11;
    r = 255;
    g = Math.floor(195 - t * 105);
    b = 0;
  } else if (dmgVal <= 60) {
    const t = (dmgVal - 50) / 10;
    r = Math.floor(255 - t * 35);
    g = Math.floor(90 - t * 90);
    b = 0;
  } else {
    const t = Math.min((dmgVal - 60) / 60, 1);
    r = Math.floor(220 - t * 100);
    g = 0;
    b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

export function isDarkColor(c: string): boolean {
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}
