/**
 * Scalability story page renderer.
 *
 * Pure client-side: loads scalability-data.json, builds derived numbers
 * (max parallel slots, sweet spot, knee, daily volume, tokens / day) on
 * the client, and renders tiles + an SVG latency chart. No backend, no
 * demo runs — the JSON is the source of truth and any number can be
 * edited there to reshape the page automatically.
 *
 * The page is intentionally about compute: density, throughput, daily
 * volume, tokens. It does NOT compare against a frontier-API $/task
 * rate — cost framing belongs on a separate, dedicated page.
 *
 * Tile renderer registry: each entry takes a `ctx` ({ scenario, instance,
 * workload, derived }) and returns { label, value, sub, accent? }. The
 * set of tiles shown for a scenario is controlled by scenario.tiles[]
 * in the JSON.
 */
(function () {
  "use strict";

  const DATA_URL = "./scalability-data.json";

  const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmtFloat1 = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  // Compact "11.4 B" / "1.4 B" / "850 M" formatter for token volumes.
  function fmtBigCount(n) {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)} B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)} K`;
    return fmtInt.format(n);
  }

  // ---------- derived-value helpers ----------

  /**
   * Sweet spot = last datapoint where p95 stays below 2× the baseline
   * (concurrency = 1st datapoint). This is the highest concurrency the
   * instance handles before queue time starts to dominate.
   */
  function findSweetSpot(datapoints) {
    if (!datapoints.length) return null;
    const baselineP95 = datapoints[0].p95_s;
    const threshold = baselineP95 * 2;
    let best = datapoints[0];
    for (const dp of datapoints) {
      if (dp.p95_s <= threshold) best = dp;
      else break;
    }
    return best;
  }

  /**
   * Knee = the LAST datapoint on the flat-ish part of the curve, i.e.
   * the one just before p95 first exceeds 2× baseline. Same as sweet
   * spot in shape, but conceptually different ("sweet spot" is where
   * you want to run; "knee" is where the curve bends).
   *
   * For mock data with a clear bend (our case), the two coincide. They
   * are split out so the schema can later add separate detection rules.
   */
  function findKnee(datapoints) {
    return findSweetSpot(datapoints);
  }

  /**
   * Max concurrent agents the instance can hold, derived from resources.
   * Single source of truth: floor(min(vcpu/per-agent, mem/per-agent)).
   * The JSON used to carry this number directly; deriving it here keeps
   * it in sync with the instance and workload definitions.
   *
   * Returns null if any per-agent resource is non-positive — division
   * would otherwise yield Infinity / NaN and the density tile would
   * render "∞ agents" on a typo. Renderers must treat null as "n/a".
   */
  function maxParallelSlots(instance, workload) {
    const vcpuPer = workload.vcpu_per_agent;
    const memPer = workload.memory_gb_per_agent;
    if (!(vcpuPer > 0) || !(memPer > 0)) return null;
    if (!(instance.vcpu >= 0) || !(instance.memory_gb >= 0)) return null;
    const byVcpu = Math.floor(instance.vcpu / vcpuPer);
    const byMem = Math.floor(instance.memory_gb / memPer);
    return Math.max(0, Math.min(byVcpu, byMem));
  }

  function buildDerived(scenario, instance, workload) {
    const dps = scenario.scaling.datapoints;
    const sweet = findSweetSpot(dps);
    const knee = findKnee(dps);
    const maxThroughput = dps.length
      ? Math.max(...dps.map((d) => d.throughput_per_min))
      : 0;
    // Volume tiles anchor on *sweet-spot* throughput, not peak. Peak
    // sits in the queueing zone (p95 way above baseline) so it's not
    // where a real operator would run. Anchoring on sweet-spot keeps
    // the "this is what you'd actually run" story internally consistent.
    const throughputAtSweet = sweet ? sweet.throughput_per_min : 0;
    const haveThroughput = throughputAtSweet > 0;
    const tasksPerDay = haveThroughput ? throughputAtSweet * 60 * 24 : null;
    const tokensPerDay =
      tasksPerDay != null ? tasksPerDay * workload.tokens_per_task : null;
    return {
      maxParallelSlots: maxParallelSlots(instance, workload),
      sweetSpot: sweet,
      knee: knee,
      maxThroughput: maxThroughput,
      sweetThroughput: haveThroughput ? throughputAtSweet : null,
      tasksPerDay: tasksPerDay,
      tokensPerDay: tokensPerDay,
    };
  }

  // ---------- tile renderers ----------

  /**
   * Sum total vCPU / memory across an instance.composition[] entry list.
   * Falls back to the flat instance.vcpu / memory_gb when composition is
   * missing, so single-node rows render the same way they always did.
   */
  function rackTotals(instance) {
    const comp = Array.isArray(instance.composition) ? instance.composition : [];
    if (!comp.length) {
      return {
        nodes: instance.nodes_per_rack || 1,
        vcpu: instance.vcpu || 0,
        memory_gb: instance.memory_gb || 0,
        composition: [],
      };
    }
    let nodes = 0, vcpu = 0, memory_gb = 0;
    for (const c of comp) {
      const n = c.count || 0;
      nodes += n;
      vcpu += n * (c.vcpu_per_node || 0);
      memory_gb += n * (c.memory_gb_per_node || 0);
    }
    return { nodes, vcpu, memory_gb, composition: comp };
  }

  const TILE_RENDERERS = {
    density: (ctx) => {
      const { instance, workload, derived } = ctx;
      const slots = derived.maxParallelSlots;
      if (slots == null) {
        return {
          label: "Density",
          value: "n/a",
          sub: "Per-agent vCPU or memory must be positive — check the workload definition.",
          accent: "default",
        };
      }
      const perCore = instance.vcpu > 0 ? slots / instance.vcpu : 0;
      const memUsedGb = slots * workload.memory_gb_per_agent;
      return {
        label: "Density",
        value: `${fmtInt.format(slots)} agents`,
        sub: `${fmtFloat1.format(perCore)} agents per vCPU · ${fmtInt.format(memUsedGb)} / ${fmtInt.format(instance.memory_gb)} GB used`,
        accent: "default",
      };
    },

    throughput: (ctx) => {
      const { derived } = ctx;
      const perMin = derived.sweetThroughput;
      if (perMin == null) {
        return {
          label: "Throughput",
          value: "n/a",
          sub: "no positive throughput in scaling datapoints",
          accent: "default",
        };
      }
      const perHour = perMin * 60;
      const peak = derived.maxThroughput;
      return {
        label: "Throughput",
        value: `${fmtFloat1.format(perMin)} / min`,
        sub: `${fmtInt.format(perHour)} tasks per hour at sweet spot · peak ${fmtFloat1.format(peak)}/min before queue`,
        accent: "accent",
      };
    },

    sweet_spot: (ctx) => {
      const { derived } = ctx;
      const s = derived.sweetSpot;
      if (!s) return { label: "Sweet spot", value: "—", sub: "" };
      return {
        label: "Sweet spot",
        value: `${s.concurrency} concurrent`,
        sub: `p95 ${fmtFloat1.format(s.p95_s)}s · ${s.utilization_pct}% utilization · stays under 2× baseline latency`,
        accent: "accent",
      };
    },

    daily_volume: (ctx) => {
      const { derived } = ctx;
      if (derived.tasksPerDay == null) {
        return {
          label: "Daily volume",
          value: "n/a",
          sub: "throughput unavailable",
          accent: "default",
        };
      }
      return {
        label: "Daily volume",
        value: `${fmtInt.format(derived.tasksPerDay)} tasks`,
        sub: "Sustained at sweet-spot concurrency over 24 h on a single node.",
        accent: "default",
      };
    },

    tokens_per_day: (ctx) => {
      const { workload, derived } = ctx;
      if (derived.tokensPerDay == null) {
        return {
          label: "Tokens / day",
          value: "n/a",
          sub: "throughput unavailable",
          accent: "default",
        };
      }
      return {
        label: "Tokens / day",
        value: fmtBigCount(derived.tokensPerDay),
        sub: `${fmtInt.format(derived.tasksPerDay)} tasks × ${fmtInt.format(workload.tokens_per_task)} tokens each.`,
        accent: "default",
      };
    },

    rack_capacity: (ctx) => {
      const { instance } = ctx;
      const totals = rackTotals(instance);
      // Single-node rows: report "1 node" so the tile is still meaningful
      // when the user lands on a non-rack scenario, but lean the framing
      // on per-node vCPU / memory rather than rack totals.
      if (totals.nodes <= 1) {
        return {
          label: "Rack capacity",
          value: "1 node",
          sub: `${fmtInt.format(totals.vcpu)} vCPU · ${fmtInt.format(totals.memory_gb)} GB on a single chassis. Scale-out story is in the rack-scale scenarios above.`,
          accent: "default",
        };
      }
      const breakdown = totals.composition.length
        ? totals.composition
            .map((c) => `${c.count}× ${c.model || "node"}`)
            .join(" + ")
        : `${totals.nodes} nodes`;
      return {
        label: "Rack capacity",
        value: `${fmtInt.format(totals.nodes)} nodes`,
        sub: `${breakdown} · ${fmtInt.format(totals.vcpu)} vCPU · ${fmtInt.format(totals.memory_gb)} GB total in the rack.`,
        accent: "accent",
      };
    },

    human_equivalent: (ctx) => {
      const { workload, derived } = ctx;
      const hoursPer1k = (workload.human_minutes_per_task * 1000) / 60;
      if (derived.sweetThroughput == null) {
        return {
          label: "Human-time equivalent",
          value: `${fmtInt.format(hoursPer1k)} h saved`,
          sub: `1 000 tasks ≈ ${fmtInt.format(hoursPer1k)} human-hours · instance time unavailable`,
          accent: "accent",
        };
      }
      const minutesOnInstance = 1000 / derived.sweetThroughput;
      return {
        label: "Human-time equivalent",
        value: `${fmtInt.format(hoursPer1k)} h saved`,
        sub: `1 000 tasks ≈ ${fmtInt.format(hoursPer1k)} human-hours; ~${fmtFloat1.format(
          minutesOnInstance
        )} min on the instance.`,
        accent: "accent",
      };
    },
  };

  // ---------- DOM rendering ----------

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      for (const c of children) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      for (const k in attrs) node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  function scenarioKindLabel(scenario) {
    const id = scenario.id || "";
    const label = scenario.label || "";
    if (id.includes("mixed") || /mixed/i.test(label)) return "mixed rack";
    if (id.includes("rack") || /rack/i.test(label)) return "rack-scale";
    return "single node";
  }

  function renderTabs(container, scenarios, activeId, onSelect) {
    container.replaceChildren();
    for (const sc of scenarios) {
      const btn = el(
        "button",
        {
          class: "sc-tab",
          type: "button",
          role: "tab",
          "aria-selected": sc.id === activeId ? "true" : "false",
          "data-id": sc.id,
          title: sc.story || sc.label || sc.id,
        },
        [
          el("span", { class: "sc-tab-label", text: sc.short_label || sc.label }),
          el("span", { class: "sc-tab-kind", text: scenarioKindLabel(sc) }),
          el("span", {
            class: "sc-tab-sub",
            text: sc.story || "",
          }),
        ]
      );
      btn.addEventListener("click", () => onSelect(sc.id));
      container.appendChild(btn);
    }
  }

  function renderInstanceCard(container, instance, workload, scenario) {
    container.replaceChildren();
    const left = el("div", {}, [
      el("div", { class: "sc-block-title", text: "Instance" }),
      el("h3", { text: instance.label }),
      el("p", {
        class: "sc-spec",
        text: `${instance.subtitle} · owned hardware`,
      }),
    ]);
    const right = el("div", {}, [
      el("div", { class: "sc-block-title", text: "Workload (per agent)" }),
      el("h3", { text: workload.label }),
      el("p", {
        class: "sc-spec",
        text: `${workload.vcpu_per_agent} vCPU · ${workload.memory_gb_per_agent} GB · ${workload.task_duration_s}s per task · ${fmtInt.format(
          workload.tokens_per_task
        )} tokens`,
      }),
    ]);
    container.appendChild(left);
    container.appendChild(right);
    if (scenario.story) {
      container.appendChild(
        el("p", { class: "sc-story", text: scenario.story })
      );
    }
  }

  /**
   * "Instance card" content for custom mode. The user has tweaked the
   * rack into a composition that no longer matches a published preset,
   * so the header reflects the rack totals + the per-node-type baseline
   * workloads instead of a single instance/workload pair.
   */
  function renderCustomInstanceCard(container, rackCounts, builderCfg, lookups, scenariosById) {
    container.replaceChildren();
    const totals = rackTotalsFromCounts(rackCounts, builderCfg);
    const compParts = builderCfg.node_types
      .filter((nt) => (rackCounts[nt.id] || 0) > 0)
      .map((nt) => `${rackCounts[nt.id]}× ${nt.short_label || nt.label}`);
    const compText = compParts.length ? compParts.join(" + ") : "empty rack";
    const left = el("div", {}, [
      el("div", { class: "sc-block-title", text: "Rack" }),
      el("h3", { text: "Custom rack" }),
      el("p", {
        class: "sc-spec",
        text: `${totals.nodes} nodes · ${fmtInt.format(totals.vcpu)} vCPU · ${fmtInt.format(
          totals.memory_gb
        )} GB · owned hardware`,
      }),
    ]);
    // Per-type workload preview in the right column so the reader can
    // see which baseline curve each node type runs against.
    const workloadLines = builderCfg.node_types
      .filter((nt) => (rackCounts[nt.id] || 0) > 0)
      .map((nt) => {
        const baseScenario = scenariosById[nt.baseline_scenario_id];
        const wl = baseScenario ? lookups.workloads[baseScenario.workload_id] : null;
        return `${nt.short_label || nt.label}: ${wl ? wl.label : "n/a"}`;
      });
    const right = el("div", {}, [
      el("div", { class: "sc-block-title", text: "Composition" }),
      el("h3", { text: compText }),
      el("p", {
        class: "sc-spec",
        text: workloadLines.length
          ? workloadLines.join(" · ")
          : "Use the +/− controls to add nodes.",
      }),
    ]);
    container.appendChild(left);
    container.appendChild(right);
    container.appendChild(
      el("p", {
        class: "sc-story",
        text: "Custom rack — derived from per-node baseline scenarios. Density and throughput tiles below recompute live from the current composition; the latency curve is only published for the preset benchmarks.",
      })
    );
  }

  function rackTotalsFromCounts(counts, builderCfg) {
    let nodes = 0,
      vcpu = 0,
      memory_gb = 0;
    for (const nt of builderCfg.node_types) {
      const n = counts[nt.id] || 0;
      nodes += n;
      vcpu += n * (nt.vcpu_per_node || 0);
      memory_gb += n * (nt.memory_gb_per_node || 0);
    }
    return { nodes, vcpu, memory_gb };
  }

  function renderTiles(container, scenario, ctx) {
    container.replaceChildren();
    const ids = scenario.tiles || [];
    for (const id of ids) {
      const renderer = TILE_RENDERERS[id];
      if (!renderer) {
        console.warn("scalability: unknown tile id", id);
        continue;
      }
      const data = renderer(ctx);
      const accentCls = data.accent && data.accent !== "default" ? ` sc-${data.accent}` : "";
      const tile = el("article", { class: "sc-tile" + accentCls }, [
        el("span", { class: "sc-tile-label", text: data.label }),
        el("span", { class: "sc-tile-value", text: data.value }),
        el("span", { class: "sc-tile-sub", text: data.sub || "" }),
      ]);
      container.appendChild(tile);
    }
  }

  // SVG line chart: latency (p50 solid, p95 dashed) vs concurrency.
  // Markers for sweet spot (green) and knee (yellow).
  function renderChart(svg, scenario, derived) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const W = 800,
      H = 320;
    const padL = 56,
      padR = 24,
      padT = 20,
      padB = 44;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const dps = scenario.scaling.datapoints;
    if (!dps.length) return;

    const xMax = Math.max(...dps.map((d) => d.concurrency));
    const yMax = Math.max(...dps.map((d) => d.p95_s)) * 1.1;

    const sx = (x) => padL + (x / xMax) * innerW;
    const sy = (y) => padT + innerH - (y / yMax) * innerH;

    // Y gridlines + labels (4 ticks).
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const yVal = (yMax * i) / yTicks;
      const y = sy(yVal);
      svg.appendChild(
        svgEl("line", {
          x1: padL,
          x2: W - padR,
          y1: y,
          y2: y,
          stroke: "rgba(165, 197, 255, 0.10)",
          "stroke-width": 1,
        })
      );
      const lbl = svgEl("text", {
        x: padL - 8,
        y: y + 4,
        "text-anchor": "end",
        fill: "#9db2cf",
        "font-size": 11,
        "font-family": "Inter, sans-serif",
      });
      lbl.textContent = `${yVal.toFixed(yVal >= 10 ? 0 : 1)}s`;
      svg.appendChild(lbl);
    }

    // X ticks at each datapoint (small labels).
    for (const dp of dps) {
      const x = sx(dp.concurrency);
      svg.appendChild(
        svgEl("line", {
          x1: x,
          x2: x,
          y1: padT + innerH,
          y2: padT + innerH + 4,
          stroke: "rgba(165, 197, 255, 0.30)",
          "stroke-width": 1,
        })
      );
      const lbl = svgEl("text", {
        x: x,
        y: padT + innerH + 18,
        "text-anchor": "middle",
        fill: "#9db2cf",
        "font-size": 11,
        "font-family": "Inter, sans-serif",
      });
      lbl.textContent = String(dp.concurrency);
      svg.appendChild(lbl);
    }

    // Axis titles.
    const xTitle = svgEl("text", {
      x: padL + innerW / 2,
      y: H - 6,
      "text-anchor": "middle",
      fill: "#9db2cf",
      "font-size": 12,
      "font-family": "Inter, sans-serif",
    });
    xTitle.textContent = "concurrency";
    svg.appendChild(xTitle);

    const yTitle = svgEl("text", {
      x: 14,
      y: padT + innerH / 2,
      "text-anchor": "middle",
      fill: "#9db2cf",
      "font-size": 12,
      "font-family": "Inter, sans-serif",
      transform: `rotate(-90 14 ${padT + innerH / 2})`,
    });
    yTitle.textContent = "latency";
    svg.appendChild(yTitle);

    // p95 line (dashed orange) — drawn first so p50 sits on top visually.
    const p95Path = dps
      .map((d, i) => `${i === 0 ? "M" : "L"}${sx(d.concurrency)},${sy(d.p95_s)}`)
      .join(" ");
    svg.appendChild(
      svgEl("path", {
        d: p95Path,
        fill: "none",
        stroke: "#ff8e5d",
        "stroke-width": 2,
        "stroke-dasharray": "6 4",
      })
    );
    // p50 line (solid cyan).
    const p50Path = dps
      .map((d, i) => `${i === 0 ? "M" : "L"}${sx(d.concurrency)},${sy(d.p50_s)}`)
      .join(" ");
    svg.appendChild(
      svgEl("path", {
        d: p50Path,
        fill: "none",
        stroke: "#45e2d5",
        "stroke-width": 2.5,
      })
    );

    // Datapoint dots for both lines.
    for (const dp of dps) {
      svg.appendChild(
        svgEl("circle", {
          cx: sx(dp.concurrency),
          cy: sy(dp.p50_s),
          r: 4,
          fill: "#45e2d5",
        })
      );
      svg.appendChild(
        svgEl("circle", {
          cx: sx(dp.concurrency),
          cy: sy(dp.p95_s),
          r: 3,
          fill: "#ff8e5d",
        })
      );
    }

    // Sweet-spot marker: green ring around the p95 dot.
    if (derived.sweetSpot) {
      const s = derived.sweetSpot;
      svg.appendChild(
        svgEl("circle", {
          cx: sx(s.concurrency),
          cy: sy(s.p95_s),
          r: 10,
          fill: "none",
          stroke: "#49d987",
          "stroke-width": 2,
        })
      );
      // Vertical guide line.
      svg.appendChild(
        svgEl("line", {
          x1: sx(s.concurrency),
          x2: sx(s.concurrency),
          y1: padT,
          y2: padT + innerH,
          stroke: "rgba(73, 217, 135, 0.28)",
          "stroke-width": 1,
          "stroke-dasharray": "3 3",
        })
      );
      const lbl = svgEl("text", {
        x: sx(s.concurrency) + 12,
        y: sy(s.p95_s) - 12,
        fill: "#49d987",
        "font-size": 11,
        "font-family": "Inter, sans-serif",
      });
      lbl.textContent = `sweet spot: ${s.concurrency}`;
      svg.appendChild(lbl);
    }

    // Knee marker (yellow ring on p95). Coincides with sweet-spot in
    // current data; offset visually so the two rings don't overlap.
    if (derived.knee && derived.knee !== derived.sweetSpot) {
      const k = derived.knee;
      svg.appendChild(
        svgEl("circle", {
          cx: sx(k.concurrency),
          cy: sy(k.p95_s),
          r: 8,
          fill: "none",
          stroke: "#ffc15c",
          "stroke-width": 2,
        })
      );
    }
  }

  function renderChartNote(noteEl, scenario, derived) {
    const s = derived.sweetSpot;
    if (!s) {
      noteEl.textContent = "";
      return;
    }
    const last = scenario.scaling.datapoints[scenario.scaling.datapoints.length - 1];
    noteEl.textContent =
      `Latency stays under 2× baseline up to ${s.concurrency} concurrent agents. ` +
      `Beyond that, the queue forms — at ${last.concurrency} concurrent, p95 is ${fmtFloat1.format(
        last.p95_s
      )}s (~${fmtFloat1.format(last.p95_s / scenario.scaling.datapoints[0].p95_s)}× baseline).`;
  }

  function renderNotes(container, instance, workload) {
    container.replaceChildren();
    const items = [
      { label: instance.label, text: instance.notes },
      { label: workload.label, text: workload.notes },
    ];
    for (const it of items) {
      if (!it.text) continue;
      const li = el("li", {}, [
        el("span", { class: "sc-note-label", text: it.label }),
        el("span", { class: "sc-note-text", text: it.text }),
      ]);
      container.appendChild(li);
    }
  }

  // ---------- rack builder ----------

  /**
   * Pull the per-node sweet-spot baseline (concurrency + throughput) out
   * of a referenced single-node scenario. Same rule as the per-scenario
   * tile pipeline: last datapoint where p95 stays under 2× the first
   * datapoint's p95.
   */
  function baselineFromScenario(scenario) {
    if (!scenario || !scenario.scaling || !scenario.scaling.datapoints?.length) {
      return null;
    }
    const sweet = findSweetSpot(scenario.scaling.datapoints);
    if (!sweet) return null;
    return {
      sweet_concurrency: sweet.concurrency,
      sweet_throughput_per_min: sweet.throughput_per_min,
    };
  }

  /**
   * Compute live rack metrics from the current per-node-type counts.
   * Returns a flat object the renderer can map straight onto tiles.
   */
  function computeBuilderMetrics(state, cfg, lookups, scenariosById) {
    const perType = [];
    let totalNodes = 0,
      totalVcpu = 0,
      totalMem = 0,
      totalTasksPerDay = 0;

    for (const nt of cfg.node_types) {
      const n = state[nt.id] || 0;
      totalNodes += n;
      totalVcpu += n * nt.vcpu_per_node;
      totalMem += n * nt.memory_gb_per_node;

      const baseline = baselineFromScenario(scenariosById[nt.baseline_scenario_id]);
      const baseScenario = scenariosById[nt.baseline_scenario_id];
      const workload = baseScenario ? lookups.workloads[baseScenario.workload_id] : null;

      let density = null,
        throughput = null,
        tasksPerDay = null;
      if (workload) {
        const byVcpu = Math.floor((n * nt.vcpu_per_node) / workload.vcpu_per_agent);
        const byMem = Math.floor((n * nt.memory_gb_per_node) / workload.memory_gb_per_agent);
        density = Math.max(0, Math.min(byVcpu, byMem));
      }
      if (baseline && n > 0) {
        throughput = baseline.sweet_throughput_per_min * n;
        tasksPerDay = throughput * 60 * 24;
        totalTasksPerDay += tasksPerDay;
      } else if (n === 0) {
        // Zero nodes of this type: render "0 / min" honestly rather than n/a.
        throughput = 0;
        tasksPerDay = 0;
      }

      perType.push({
        nodeType: nt,
        count: n,
        baseline,
        workload,
        density,
        throughput,
        tasksPerDay,
      });
    }

    return {
      perType,
      totalNodes,
      totalVcpu,
      totalMem,
      totalTasksPerDay,
    };
  }

  function renderBuilderRack(rackEl, state, cfg) {
    rackEl.replaceChildren();
    const total = cfg.rack_units_total;
    const fixtureTop = cfg.rack_units_fixture_top || 0;
    const fixtureBottom = (cfg.rack_units_fixture || 0) - fixtureTop;
    const usable = total - fixtureTop - fixtureBottom;

    // Build the slot list top-to-bottom. Top fixture rows first (top
    // switches), then node rows in the order node_types are declared,
    // then empty Us, then bottom fixture rows (PDUs).
    const slots = [];
    for (let i = 0; i < fixtureTop; i++) {
      slots.push({ class: "sc-rack-u-fixture", text: i === 0 ? "switch" : "" });
    }
    let placed = 0;
    for (const nt of cfg.node_types) {
      const n = Math.min(state[nt.id] || 0, usable - placed);
      for (let i = 0; i < n; i++) {
        slots.push({ class: nt.swatch_class, text: nt.short_label || nt.label });
      }
      placed += n;
    }
    while (slots.length < fixtureTop + usable) {
      slots.push({ class: "", text: "" });
    }
    for (let i = 0; i < fixtureBottom; i++) {
      slots.push({
        class: "sc-rack-u-fixture",
        text: i === fixtureBottom - 1 ? "PDU" : "",
      });
    }

    for (const s of slots) {
      const cls = "sc-rack-u" + (s.class ? " " + s.class : "");
      rackEl.appendChild(el("div", { class: cls, text: s.text || "" }));
    }
  }

  function renderBuilderControls(controlsEl, state, cfg, onChange) {
    controlsEl.replaceChildren();
    for (const nt of cfg.node_types) {
      const dec = el("button", {
        type: "button",
        class: "sc-builder-btn",
        "data-id": `dec-${nt.id}`,
        "aria-label": `Remove one ${nt.label} node`,
      });
      dec.textContent = "−";
      const inc = el("button", {
        type: "button",
        class: "sc-builder-btn",
        "data-id": `inc-${nt.id}`,
        "aria-label": `Add one ${nt.label} node`,
      });
      inc.textContent = "+";
      const count = el("span", {
        class: "sc-builder-count",
        "data-id": `count-${nt.id}`,
      });
      count.textContent = String(state[nt.id] || 0);

      const meta = el("div", { class: "sc-builder-row-meta" }, [
        el("span", { class: "sc-builder-row-label", text: nt.label }),
        el("span", { class: "sc-builder-row-sub", text: nt.subtitle || "" }),
      ]);

      const row = el("div", { class: "sc-builder-row", "data-id": `row-${nt.id}` }, [
        meta,
        dec,
        count,
        inc,
      ]);
      controlsEl.appendChild(row);

      dec.addEventListener("click", () => onChange(nt.id, -1));
      inc.addEventListener("click", () => onChange(nt.id, +1));
    }
  }

  function refreshBuilderControlState(controlsEl, state, cfg) {
    const totalNodes = cfg.node_types.reduce((s, nt) => s + (state[nt.id] || 0), 0);
    const usable = cfg.rack_units_total - (cfg.rack_units_fixture || 0);
    const hardCap = Math.min(cfg.max_total_nodes || usable, usable);
    for (const nt of cfg.node_types) {
      const n = state[nt.id] || 0;
      const dec = controlsEl.querySelector(`[data-id="dec-${nt.id}"]`);
      const inc = controlsEl.querySelector(`[data-id="inc-${nt.id}"]`);
      const count = controlsEl.querySelector(`[data-id="count-${nt.id}"]`);
      if (count) count.textContent = String(n);
      if (dec) dec.disabled = n <= 0;
      if (inc) inc.disabled = n >= (nt.max_count || hardCap) || totalNodes >= hardCap;
    }
  }

  function renderBuilderTiles(tilesEl, metrics) {
    tilesEl.replaceChildren();
    // Total rack capacity tile.
    const totalTile = el("article", { class: "sc-tile sc-accent" }, [
      el("span", { class: "sc-tile-label", text: "Rack total" }),
      el("span", { class: "sc-tile-value", text: `${fmtInt.format(metrics.totalNodes)} nodes` }),
      el("span", {
        class: "sc-tile-sub",
        text: `${fmtInt.format(metrics.totalVcpu)} vCPU · ${fmtInt.format(metrics.totalMem)} GB across the rack.`,
      }),
    ]);
    tilesEl.appendChild(totalTile);

    // Per-workload tiles.
    for (const t of metrics.perType) {
      const w = t.workload;
      const wlLabel = w ? w.label : "n/a";
      const densityText = t.density != null ? `${fmtInt.format(t.density)} agents` : "n/a";
      const throughputText =
        t.throughput != null ? `${fmtFloat1.format(t.throughput)} / min` : "n/a";
      const tile = el("article", { class: "sc-tile" }, [
        el("span", {
          class: "sc-tile-label",
          text: `${t.nodeType.short_label || t.nodeType.label} · ${wlLabel}`,
        }),
        el("span", { class: "sc-tile-value", text: densityText }),
        el("span", {
          class: "sc-tile-sub",
          text:
            t.count > 0
              ? `${t.count}× ${t.nodeType.label} → ${throughputText} at sweet spot.`
              : `0× ${t.nodeType.label} — workload not running on this rack.`,
        }),
      ]);
      tilesEl.appendChild(tile);
    }

    // Combined throughput tile — total daily volume across all
    // configured node types, expressed in tasks/day.
    const combined = el("article", { class: "sc-tile sc-accent" }, [
      el("span", { class: "sc-tile-label", text: "Combined daily volume" }),
      el("span", {
        class: "sc-tile-value",
        text: `${fmtBigCount(metrics.totalTasksPerDay)} tasks`,
      }),
      el("span", {
        class: "sc-tile-sub",
        text: "Sum of sweet-spot throughput across all node types over 24 h.",
      }),
    ]);
    tilesEl.appendChild(combined);
  }

  function renderBuilderSummary(summaryEl, metrics, cfg, mode) {
    const usable = cfg.rack_units_total - (cfg.rack_units_fixture || 0);
    const parts = metrics.perType.map(
      (t) => `<strong>${t.count}× ${t.nodeType.short_label || t.nodeType.label}</strong>`
    );
    const badgeCls = mode === "custom" ? "sc-mode-custom" : "";
    const badgeText = mode === "custom" ? "Custom" : "Preset";
    summaryEl.innerHTML =
      `Current rack: ${parts.join(" + ")} · ${metrics.totalNodes} of ${usable} usable U occupied.` +
      ` <span class="sc-builder-summary-mode ${badgeCls}">${badgeText}</span>`;
  }

  /**
   * Map a scenario's instance.composition[] into per-node-type counts
   * the rack builder understands. Falls back to a heuristic on the
   * model string ("CWF" / "GNR") so single-node rows render the same
   * sized rack as their rack-scale siblings without extra JSON.
   */
  function scenarioToRackCounts(scenario, lookups, builderCfg) {
    const counts = Object.fromEntries(builderCfg.node_types.map((nt) => [nt.id, 0]));
    if (!scenario) return counts;
    const inst = lookups.instances[scenario.instance_id];
    if (!inst) return counts;
    const comp = Array.isArray(inst.composition) ? inst.composition : [];
    for (const c of comp) {
      const m = (c.model || "").toLowerCase();
      let typeId = null;
      if (m.includes("cwf")) typeId = "cwf";
      else if (m.includes("gnr")) typeId = "gnr";
      // Fall back to label-based matching for builder configs that
      // diverge from the CWF/GNR naming convention used in the JSON.
      if (!typeId) {
        for (const nt of builderCfg.node_types) {
          const ntLabel = (nt.label || "").toLowerCase();
          const ntShort = (nt.short_label || "").toLowerCase();
          if ((ntLabel && m.includes(ntLabel)) || (ntShort && m.includes(ntShort))) {
            typeId = nt.id;
            break;
          }
        }
      }
      if (typeId && counts[typeId] !== undefined) {
        counts[typeId] += c.count || 0;
      }
    }
    // Cap each count at the per-type max so a misconfigured JSON entry
    // can't render a rack that exceeds the visualization budget.
    for (const nt of builderCfg.node_types) {
      const cap = nt.max_count || builderCfg.max_total_nodes || builderCfg.rack_units_total;
      if (counts[nt.id] > cap) counts[nt.id] = cap;
    }
    return counts;
  }

  /**
   * Wipe the chart SVG and replace it with a centered note. Used in
   * custom mode where the per-scenario queueing curve no longer
   * matches the user's rack composition.
   */
  function clearChartWithNote(svg, message) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = 800,
      H = 320;
    const text = svgEl("text", {
      x: W / 2,
      y: H / 2,
      "text-anchor": "middle",
      fill: "#9db2cf",
      "font-size": 14,
      "font-family": "Inter, sans-serif",
    });
    text.textContent = message;
    svg.appendChild(text);
  }

  // ---------- main ----------

  function buildLookups(data) {
    const byId = (arr) => Object.fromEntries((arr || []).map((x) => [x.id, x]));
    return {
      instances: byId(data.instances),
      workloads: byId(data.workloads),
    };
  }

  function showError(msg) {
    const box = document.getElementById("sc-error");
    box.hidden = false;
    box.textContent = msg;
  }

  /**
   * Single state-driven render. The page exposes one combined block:
   * a scenario picker on the left, an instance card + rack diagram +
   * tiles + latency chart on the right. State carries either an
   * active preset id (drives every section from the matching scenario)
   * or null (custom mode — rack composition came from the +/- controls).
   */
  function renderAll(data, lookups, builderCfg, scenariosById, state) {
    const tabsEl = document.getElementById("sc-tabs");
    const instanceEl = document.getElementById("sc-instance");
    const rackEl = document.getElementById("sc-builder-rack");
    const controlsEl = document.getElementById("sc-builder-controls");
    const summaryEl = document.getElementById("sc-builder-summary");
    const tilesEl = document.getElementById("sc-tiles");
    const chartEl = document.getElementById("sc-chart");
    const chartNoteEl = document.getElementById("sc-chart-note");
    const notesEl = document.getElementById("sc-notes");

    // Tabs always reflect the current presetId — null deselects all.
    renderTabs(tabsEl, data.scenarios, state.presetId, (id) => {
      const scenario = data.scenarios.find((s) => s.id === id);
      if (!scenario) return;
      state.presetId = id;
      state.rackCounts = scenarioToRackCounts(scenario, lookups, builderCfg);
      renderAll(data, lookups, builderCfg, scenariosById, state);
    });

    // Rack diagram + +/- controls always mirror state.rackCounts.
    if (rackEl && controlsEl && builderCfg) {
      renderBuilderRack(rackEl, state.rackCounts, builderCfg);
      refreshBuilderControlState(controlsEl, state.rackCounts, builderCfg);
      const metrics = computeBuilderMetrics(
        state.rackCounts,
        builderCfg,
        lookups,
        scenariosById
      );
      if (summaryEl) {
        renderBuilderSummary(
          summaryEl,
          metrics,
          builderCfg,
          state.presetId ? "preset" : "custom"
        );
      }
    }

    // Mode-dependent sections: instance card, tiles, chart, notes.
    if (state.presetId) {
      const scenario = data.scenarios.find((s) => s.id === state.presetId);
      const instance = lookups.instances[scenario.instance_id];
      const workload = lookups.workloads[scenario.workload_id];
      if (!instance || !workload) {
        showError(
          `Scenario "${scenario.id}" references missing instance/workload (instance_id=${scenario.instance_id}, workload_id=${scenario.workload_id}).`
        );
        return;
      }
      const derived = buildDerived(scenario, instance, workload);
      const ctx = { scenario, instance, workload, derived };
      renderInstanceCard(instanceEl, instance, workload, scenario);
      renderTiles(tilesEl, scenario, ctx);
      chartEl.classList.remove("sc-chart-disabled");
      renderChart(chartEl, scenario, derived);
      renderChartNote(chartNoteEl, scenario, derived);
      renderNotes(notesEl, instance, workload);
    } else if (builderCfg) {
      const metrics = computeBuilderMetrics(
        state.rackCounts,
        builderCfg,
        lookups,
        scenariosById
      );
      renderCustomInstanceCard(instanceEl, state.rackCounts, builderCfg, lookups, scenariosById);
      renderBuilderTiles(tilesEl, metrics);
      chartEl.classList.add("sc-chart-disabled");
      clearChartWithNote(
        chartEl,
        "Custom rack — pick a preset above to see a benchmarked latency curve."
      );
      chartNoteEl.textContent =
        "The latency curve is published per benchmarked preset. Tile values above still recompute from per-node baselines for the current rack composition.";
      // Notes panel: list each baseline scenario the custom rack is
      // drawing density / throughput numbers from, so the reader can
      // trace any tile back to a published curve.
      notesEl.replaceChildren();
      for (const nt of builderCfg.node_types) {
        if ((state.rackCounts[nt.id] || 0) <= 0) continue;
        const baseScenario = scenariosById[nt.baseline_scenario_id];
        if (!baseScenario) continue;
        const inst = lookups.instances[baseScenario.instance_id];
        const wl = lookups.workloads[baseScenario.workload_id];
        if (!inst || !wl) continue;
        const li = el("li", {}, [
          el("span", {
            class: "sc-note-label",
            text: `${nt.label} → ${baseScenario.short_label || baseScenario.label}`,
          }),
          el("span", {
            class: "sc-note-text",
            text: `${inst.notes || ""} ${wl.notes || ""}`.trim() ||
              "Density and throughput are scaled linearly from the per-node baseline.",
          }),
        ]);
        notesEl.appendChild(li);
      }
    }
  }

  function attachBuilderControls(builderCfg, onChange) {
    const controlsEl = document.getElementById("sc-builder-controls");
    if (!controlsEl || !builderCfg) return;
    // Render the row markup once with stub state — the real counts and
    // disabled flags get refreshed inside renderAll() on every render.
    const stubState = Object.fromEntries(builderCfg.node_types.map((nt) => [nt.id, 0]));
    renderBuilderControls(controlsEl, stubState, builderCfg, onChange);
  }

  async function main() {
    let data;
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      showError(`Failed to load ${DATA_URL}: ${err.message}`);
      return;
    }
    if (!data.scenarios || !data.scenarios.length) {
      showError("scalability-data.json: no scenarios defined.");
      return;
    }

    const lookups = buildLookups(data);
    const builderCfg = data.rack_builder || null;
    const scenariosById = Object.fromEntries(
      (data.scenarios || []).map((s) => [s.id, s])
    );

    // First scenario becomes the default preset; its rack composition
    // seeds the diagram so the page lands with everything in sync.
    const firstScenario = data.scenarios[0];
    const state = {
      presetId: firstScenario.id,
      rackCounts: builderCfg
        ? scenarioToRackCounts(firstScenario, lookups, builderCfg)
        : {},
    };

    if (builderCfg) {
      attachBuilderControls(builderCfg, (typeId, delta) => {
        const nt = builderCfg.node_types.find((x) => x.id === typeId);
        if (!nt) return;
        const usable =
          builderCfg.rack_units_total - (builderCfg.rack_units_fixture || 0);
        const hardCap = Math.min(builderCfg.max_total_nodes || usable, usable);
        const next = (state.rackCounts[typeId] || 0) + delta;
        const totalAfter =
          builderCfg.node_types.reduce(
            (s, x) => s + (state.rackCounts[x.id] || 0),
            0
          ) + delta;
        if (next < 0) return;
        if (next > (nt.max_count || hardCap)) return;
        if (totalAfter > hardCap) return;
        state.rackCounts[typeId] = next;
        // Tweaking the +/- controls drops out of preset mode — the
        // composition no longer matches a published benchmark.
        state.presetId = null;
        renderAll(data, lookups, builderCfg, scenariosById, state);
      });
    }

    renderAll(data, lookups, builderCfg, scenariosById, state);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
