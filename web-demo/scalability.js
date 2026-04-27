/**
 * Scalability story page renderer.
 *
 * Pure client-side: loads scalability-data.json, builds derived numbers
 * (sweet spot, knee, cost-per-task, etc.) on the client, and renders
 * tiles + an SVG latency chart. No backend, no demo runs — the JSON is
 * the source of truth and any number can be edited there to reshape the
 * page automatically.
 *
 * Tile renderer registry: each entry takes a `ctx` ({ scenario, instance,
 * workload, comparator, derived }) and returns { label, value, sub,
 * accent? }. The set of tiles shown for a scenario is controlled by
 * scenario.tiles[] in the JSON.
 */
(function () {
  "use strict";

  const DATA_URL = "./scalability-data.json";

  const fmtUSD = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  });
  const fmtUSD2 = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  const fmtInt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const fmtFloat1 = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

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
   * Per-task cost in USD, evaluated at the sweet-spot throughput.
   *  hourly_usd / 60 = $/min ; throughput in tasks/min ; result $/task.
   */
  function costPerTask(instance, throughputPerMin) {
    if (!throughputPerMin) return 0;
    return instance.hourly_usd / 60 / throughputPerMin;
  }

  function buildDerived(scenario, instance, workload, comparator) {
    const dps = scenario.scaling.datapoints;
    const sweet = findSweetSpot(dps);
    const knee = findKnee(dps);
    const maxThroughput = Math.max(...dps.map((d) => d.throughput_per_min));
    const cpt = costPerTask(instance, sweet ? sweet.throughput_per_min : 0);
    const cpt1k = cpt * 1000;
    // All economic tiles below use the *sweet-spot* throughput. Picking
    // the peak throughput makes per-task cost look better but it lives
    // in the queueing zone (p95 way above baseline), so it's not where
    // a real operator would run. Anchoring on sweet-spot keeps the
    // "this is what you'd actually run" story internally consistent.
    const throughputAtSweet = sweet ? sweet.throughput_per_min : 0;
    return {
      sweetSpot: sweet,
      knee: knee,
      maxThroughput: maxThroughput,
      sweetThroughput: throughputAtSweet,
      costPerTaskUsd: cpt,
      costPer1kTasksUsd: cpt1k,
      tasksPerDay: throughputAtSweet * 60 * 24,
      dailyCostUsd: instance.hourly_usd * 24,
      comparator: comparator || null,
      savingsRatio: comparator
        ? comparator.cost_per_1k_tasks_usd / Math.max(cpt1k, 0.0001)
        : null,
    };
  }

  // ---------- tile renderers ----------

  const TILE_RENDERERS = {
    density: (ctx) => {
      const { scenario, instance, workload } = ctx;
      const slots = scenario.scaling.max_parallel_slots;
      const perCore = slots / instance.vcpu;
      const memUsedGb = slots * workload.memory_gb_per_agent;
      return {
        label: "Density",
        value: `${slots} agents`,
        sub: `${fmtFloat1.format(perCore)} agents per vCPU · ${fmtInt.format(memUsedGb)} / ${fmtInt.format(instance.memory_gb)} GB used`,
        accent: "default",
      };
    },

    throughput: (ctx) => {
      const { derived } = ctx;
      const perMin = derived.sweetThroughput;
      const perHour = perMin * 60;
      const peak = derived.maxThroughput;
      return {
        label: "Throughput",
        value: `${fmtFloat1.format(perMin)} / min`,
        sub: `${fmtInt.format(perHour)} tasks per hour at sweet spot · peak ${fmtFloat1.format(peak)}/min before queue`,
        accent: "accent",
      };
    },

    cost_per_task: (ctx) => {
      const { derived } = ctx;
      // Headline as $/1k tasks — easier to read than fractional cents.
      return {
        label: "Cost per 1 000 tasks",
        value: fmtUSD2.format(derived.costPer1kTasksUsd),
        sub: `${fmtUSD.format(derived.costPerTaskUsd)} per task at sweet-spot throughput`,
        accent: "accent-good",
      };
    },

    vs_comparator: (ctx) => {
      const { derived } = ctx;
      if (!derived.comparator) {
        return {
          label: "vs baseline",
          value: "n/a",
          sub: "no comparator configured",
          accent: "default",
        };
      }
      const cmp = derived.comparator;
      const ratio = derived.savingsRatio;
      const ratioText =
        ratio >= 10
          ? `${fmtInt.format(ratio)}× cheaper`
          : `${fmtFloat1.format(ratio)}× cheaper`;
      return {
        label: `vs ${cmp.label}`,
        value: ratioText,
        sub: `${fmtUSD2.format(derived.costPer1kTasksUsd)} vs ${fmtUSD2.format(cmp.cost_per_1k_tasks_usd)} per 1 000 tasks`,
        accent: "accent-good",
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

    idle_cost: (ctx) => {
      const { instance } = ctx;
      const idle = instance.idle_cost_usd || 0;
      return {
        label: "Idle cost",
        value: fmtUSD2.format(idle) + " / hr",
        sub:
          idle === 0
            ? "Job-model: no agents running, no charge — no Deployments held warm."
            : "Active even when idle.",
        accent: idle === 0 ? "accent-good" : "accent-warm",
      };
    },

    daily_volume: (ctx) => {
      const { derived } = ctx;
      return {
        label: "Daily volume",
        value: `${fmtInt.format(derived.tasksPerDay)} tasks`,
        sub: `${fmtUSD2.format(derived.dailyCostUsd)} per node-day at peak load`,
        accent: "default",
      };
    },

    human_equivalent: (ctx) => {
      const { workload, derived } = ctx;
      const hoursPer1k = (workload.human_minutes_per_task * 1000) / 60;
      const minutesOnInstance = 1000 / derived.sweetThroughput;
      return {
        label: "Human-time equivalent",
        value: `${fmtInt.format(hoursPer1k)} h saved`,
        sub: `1 000 tasks ≈ ${fmtInt.format(hoursPer1k)} human-hours; ~${fmtFloat1.format(
          minutesOnInstance
        )} min on the instance @ ${fmtUSD2.format(derived.costPer1kTasksUsd)}`,
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
        },
        [
          el("span", { class: "sc-tab-label", text: sc.label }),
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
        text: `${instance.subtitle} · ${fmtUSD2.format(instance.hourly_usd)} / hr`,
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

  function renderNotes(container, instance, workload, comparator) {
    container.replaceChildren();
    const items = [
      { label: instance.label, text: instance.notes },
      { label: workload.label, text: workload.notes },
    ];
    if (comparator) {
      items.push({ label: comparator.label, text: comparator.notes });
    }
    for (const it of items) {
      if (!it.text) continue;
      const li = el("li", {}, [
        el("span", { class: "sc-note-label", text: it.label }),
        el("span", { class: "sc-note-text", text: it.text }),
      ]);
      container.appendChild(li);
    }
  }

  // ---------- main ----------

  function buildLookups(data) {
    const byId = (arr) => Object.fromEntries((arr || []).map((x) => [x.id, x]));
    return {
      instances: byId(data.instances),
      workloads: byId(data.workloads),
      comparators: byId(data.comparators),
    };
  }

  function renderScenario(data, lookups, scenarioId) {
    const scenario = data.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return;
    const instance = lookups.instances[scenario.instance_id];
    const workload = lookups.workloads[scenario.workload_id];
    const comparator = scenario.economics
      ? lookups.comparators[scenario.economics.comparator_id]
      : null;
    if (!instance || !workload) {
      showError(
        `Scenario "${scenario.id}" references missing instance/workload (instance_id=${scenario.instance_id}, workload_id=${scenario.workload_id}).`
      );
      return;
    }
    const derived = buildDerived(scenario, instance, workload, comparator);
    const ctx = { scenario, instance, workload, comparator, derived };

    renderInstanceCard(document.getElementById("sc-instance"), instance, workload, scenario);
    renderTiles(document.getElementById("sc-tiles"), scenario, ctx);
    renderChart(document.getElementById("sc-chart"), scenario, derived);
    renderChartNote(document.getElementById("sc-chart-note"), scenario, derived);
    renderNotes(document.getElementById("sc-notes"), instance, workload, comparator);
  }

  function showError(msg) {
    const box = document.getElementById("sc-error");
    box.hidden = false;
    box.textContent = msg;
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
    let activeId = data.scenarios[0].id;

    const tabsEl = document.getElementById("sc-tabs");
    const onSelect = (id) => {
      if (id === activeId) return;
      activeId = id;
      // Re-render tabs to update aria-selected, and the rest of the page.
      renderTabs(tabsEl, data.scenarios, activeId, onSelect);
      renderScenario(data, lookups, activeId);
    };
    renderTabs(tabsEl, data.scenarios, activeId, onSelect);
    renderScenario(data, lookups, activeId);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
