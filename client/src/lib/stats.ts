const T_CRITICAL_95: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.160,
  14: 2.145,
  15: 2.131,
  16: 2.120,
  17: 2.110,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  25: 2.060,
  30: 2.042,
};

function tCritical95(df: number) {
  if (df <= 0) return 1.96;
  if (T_CRITICAL_95[df]) return T_CRITICAL_95[df];
  if (df <= 30) return T_CRITICAL_95[30];
  return 1.96;
}

function isBinary(scores: number[]) {
  return scores.every((s) => s === 0 || s === 1);
}

function wilsonCI(successes: number, trials: number) {
  if (trials <= 0) return { mean: 0, moe: 0 };
  const z = 1.96;
  const phat = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = (phat + (z * z) / (2 * trials)) / denom;
  const margin = (z / denom) * Math.sqrt((phat * (1 - phat) / trials) + (z * z) / (4 * trials * trials));
  return { mean: phat, moe: margin };
}

export function computeCI(scores: number[]) {
  if (!scores.length) return null;
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  if (scores.length < 2) return { mean, moe: 0 };

  if (isBinary(scores)) {
    const successes = scores.reduce<number>((sum, s) => sum + s, 0);
    return wilsonCI(successes, scores.length);
  }

  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / (scores.length - 1);
  const sem = Math.sqrt(variance / scores.length);
  const t = tCritical95(scores.length - 1);
  return { mean, moe: t * sem };
}

export function pairedTTest(scoresA: number[], scoresB: number[]) {
  if (scoresA.length !== scoresB.length || scoresA.length < 5) return null;
  const n = scoresA.length;
  
  let diffSum = 0;
  const diffs = new Array(n);
  for (let i = 0; i < n; i++) {
    const d = scoresA[i] - scoresB[i];
    diffs[i] = d;
    diffSum += d;
  }
  
  const diffMean = diffSum / n;
  
  let diffSqSum = 0;
  for (let i = 0; i < n; i++) {
    diffSqSum += Math.pow(diffs[i] - diffMean, 2);
  }
  
  const diffVar = diffSqSum / (n - 1);
  if (diffVar === 0) {
    return { significant: diffMean !== 0, meanDiff: diffMean, pValueFast: diffMean === 0 ? 1 : 0 };
  }
  
  const sem = Math.sqrt(diffVar / n);
  const tStat = Math.abs(diffMean / sem);
  const df = n - 1;
  const tCrit = tCritical95(df);
  
  return { 
    significant: tStat > tCrit,
    meanDiff: diffMean,
    tStat
  };
}
