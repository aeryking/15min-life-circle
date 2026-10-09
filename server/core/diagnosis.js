import { CATEGORY_MAP } from './categories.js';

/**
 * 规则引擎：把体检数据转写为结构化诊断（结论 / 优势 / 短板 / 盲区 / 适老 / 建议）。
 * 所有结论都能追溯到具体指标，保证在未接入大模型时也能输出可信、可解释的报告。
 */
export function buildDiagnosis(result) {
  const { name, score, access, blind, siting, isochrone, profiles } = result;
  const adult = profiles.find((p) => p.key === 'adult') || profiles[0];
  const elderly = profiles.find((p) => p.key === 'elderly');
  const child = profiles.find((p) => p.key === 'child');
  const km2 = (m2) => (m2 / 1e6).toFixed(2);
  const m = isochrone.metrics;
  const mins = m.minutes ?? result.params?.minutes ?? 15;

  const strengths = [];
  const weaknesses = [];
  for (const c of score.categories) {
    const a = access.find((x) => x.key === c.key);
    if (!a.nearest) {
      weaknesses.push({ key: c.key, text: `检索范围内未发现「${a.name}」，属于缺项。`, severity: a.critical ? 3 : 2 });
      continue;
    }
    const t = a.nearest.minutes[adult.key];
    if (c.score >= 85) strengths.push({ key: c.key, text: `${a.name}：最近「${a.nearest.name}」步行约 ${t} 分钟，圈内 ${c.count} 处。` });
    else if (c.score < 60) {
      weaknesses.push({
        key: c.key,
        text: `${a.name}：最近一处「${a.nearest.name}」需步行约 ${t} 分钟（目标 ≤ ${a.targetMinutes} 分钟），圈内仅 ${c.count} 处。`,
        severity: a.critical ? 3 : t > a.targetMinutes * 2 ? 2 : 1,
      });
    }
  }
  weaknesses.sort((a, b) => b.severity - a.severity);

  // 以居住小区（点位）为主语描述盲区，面积占比作为补充；并指出直线口径发现不了的隐性盲区
  const L = blind.threshold;
  const blindLines = Object.values(blind.categories)
    .filter((c) => c.blindCells > 0 || c.residentialBlind.length > 0)
    .map((c) => {
      const res = c.residentialBlind
        .slice(0, 4)
        .map((r) => r.name)
        .join('、');
      const who = c.residentialBlind.length
        ? `圈内 ${c.residentialTotal} 个小区中有 ${c.residentialBlind.length} 个（${res}${c.residentialBlind.length > 4 ? ' 等' : ''}）步行 ${L} 米内没有${c.name}`
        : `圈内小区均可步行 ${L} 米内到达${c.name}，但仍有部分区域不能`;
      const hidden = c.residentialHidden ? `，其中 ${c.residentialHidden} 个直线 1 公里内就有、实际要绕路走超过 1 公里（隐性盲区）` : '';
      return `${c.name}：${who}${hidden}；按面积计 ${(c.blindRatio * 100).toFixed(1)}%（约 ${(c.blindAreaM2 / 10000).toFixed(1)} 公顷）。`;
    });

  const elderlyText = elderly
    ? (() => {
        const ea = m.areas[elderly.key];
        const aa = m.areas[adult.key];
        const shrink = aa ? Math.round((1 - ea / aa) * 100) : 0;
        const lost = access.filter((a) => a.nearest && a.nearest.minutes[adult.key] <= mins && a.nearest.minutes[elderly.key] > mins).map((a) => a.name);
        return `按老年人步速 ${elderly.speed} m/s 计算，${mins} 分钟可达面积为 ${km2(ea)} km²，比成年人（${km2(aa)} km²）缩小 ${shrink}%。${
          lost.length ? `对老年人而言，${lost.join('、')}已超出 ${mins} 分钟步行范围。` : `主要设施对老年人仍可在 ${mins} 分钟内到达。`
        }`;
      })()
    : '';

  // 亲子视角：陪同儿童步速下，幼儿园 / 小学 / 公园三类「一小」设施能否在各自目标时间内到达
  const childText = child
    ? (() => {
        const keys = ['kindergarten', 'primary_school', 'park'];
        const items = keys.map((k) => access.find((a) => a.key === k)).filter(Boolean);
        const parts = items.map((a) => (a.nearest ? `${a.name} ${a.nearest.minutes[child.key]} 分钟` : `${a.name}未发现`));
        const late = items.filter((a) => !a.nearest || a.nearest.minutes[child.key] > a.targetMinutes);
        const cs = result.childScore;
        return `按陪同儿童步速 ${Number.isInteger(child.speed) ? child.speed.toFixed(1) : child.speed} m/s 计算，最近的${parts.join('、')}。${
          late.length ? `${late.map((a) => `${a.name}（目标 ≤ ${a.targetMinutes} 分钟）`).join('、')}超出亲子步行目标。` : '三类设施均在亲子步行目标时间内。'
        }${cs ? `亲子视角评分 ${cs.total} 分（${cs.grade}）。` : ''}`;
      })()
    : '';

  const recommendations = [];
  for (const s of siting) {
    const top = s.sites[0];
    const where = top.description || top.address || `(${top.lng.toFixed(5)}, ${top.lat.toFixed(5)})`;
    recommendations.push({
      priority: s.demandResidential > 0 ? '高' : '中',
      title: `补齐${s.name}：建议在 ${where} 附近新增一处`,
      detail: `${s.basis === 'verified' ? '经候选点实测择优，' : ''}预计可消除 ${s.reduction}% 的${s.short}盲区需求${top.coveredResidential.length ? `，惠及 ${top.coveredResidential.slice(0, 3).join('、')} 等 ${top.coveredResidential.length} 个小区` : ''}${
        s.verified ? `；已对 ${s.verified.measured} 个需求点实测，其中 ${s.verified.covered} 个步行距离 ≤ 1 km` : ''
      }。`,
    });
  }
  for (const w of weaknesses.filter((x) => !CATEGORY_MAP[x.key]?.critical).slice(0, 3)) {
    const cat = CATEGORY_MAP[w.key];
    recommendations.push({
      priority: w.severity >= 2 ? '中' : '低',
      title: `提升${cat.name}可达性`,
      detail: `${w.text} 可结合社区闲置用房、底商或公共空间补点。`,
    });
  }
  if (elderly && m.areas[elderly.key] / m.areas[adult.key] < 0.6) {
    recommendations.push({
      priority: '中',
      title: '开展适老化步行环境改造',
      detail: `老年人 ${mins} 分钟可达范围明显收缩，建议优化过街设施、增设休憩座椅与无障碍坡道，并就近布局助餐与养老驿站。`,
    });
  }

  // 幼儿园 / 小学超出亲子步行目标（或缺失）时提示；缺失或超出 1.5 倍目标为中优先级
  const lateSchools = child
    ? ['kindergarten', 'primary_school']
        .map((k) => access.find((a) => a.key === k))
        .filter((a) => a && (!a.nearest || a.nearest.minutes[child.key] > a.targetMinutes))
    : [];
  if (lateSchools.length) {
    const severe = lateSchools.some((a) => !a.nearest || a.nearest.minutes[child.key] > a.targetMinutes * 1.5);
    const cs = result.childScore;
    recommendations.push({
      priority: severe ? '中' : '低',
      title: '补强儿童友好设施',
      detail: `按陪同儿童步速，${lateSchools
        .map((a) => (a.nearest ? `${a.name}需 ${a.nearest.minutes[child.key]} 分钟（目标 ≤ ${a.targetMinutes} 分钟）` : `未发现${a.name}`))
        .join('，')}${cs ? `，亲子视角评分 ${cs.total} 分` : ''}。建议结合托育与学位规划就近补点，并改善上学路径的过街安全与人行道连续性。`,
    });
  }

  const blindTotal = blind.union;
  const summary = `${name}以真实步行路网测算，成年人 ${mins} 分钟可达面积 ${km2(m.areas[adult.key])} km²，仅为「直线画圆」的 ${(
    100 - m.circleOverestimate
  ).toFixed(0)}%（区域平均绕行系数 ${m.lambda.median}）。综合评分 ${score.total} 分（${score.grade}）。${
    blindTotal.blindCells || blindTotal.residentialBlind
      ? `${
          blindTotal.residentialTotal
            ? `圈内 ${blindTotal.residentialTotal} 个小区中有 ${blindTotal.residentialBlind} 个存在菜市场、药店或小学的步行 1 公里服务盲区${
                blindTotal.residentialHidden ? `（其中 ${blindTotal.residentialHidden} 个为直线看不出的隐性盲区）` : ''
              }，`
            : ''
        }按面积计占生活圈的 ${(blindTotal.blindRatio * 100).toFixed(1)}%。`
      : '未发现菜市场、药店、小学的步行 1 公里服务盲区。'
  }`;

  return {
    headline: `${name} · ${mins} 分钟生活圈体检：${score.grade} ${score.total} 分`,
    summary,
    strengths,
    weaknesses,
    blindSpots: blindLines,
    elderly: elderlyText,
    child: childText,
    recommendations,
    generatedBy: 'rules',
  };
}
