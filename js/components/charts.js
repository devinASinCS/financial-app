/**
 * Charts — Chart.js wrappers
 */
const Charts = (() => {
  const _instances = {}; // canvasId -> Chart instance

  function destroy(id) {
    if (_instances[id]) {
      _instances[id].destroy();
      delete _instances[id];
    }
  }

  // ── Holdings Pie Chart ──────────────────────────────────────────
  function renderHoldingsPie(canvasId, holdings, currency = 'TWD') {
    destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (!holdings || holdings.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.parentElement.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">尚無持股資料</div></div>`;
      return;
    }

    // Use totalCost for allocation (since we don't have real-time prices)
    const labels = holdings.map(h => `${h.symbol} ${h.name}`);
    const data   = holdings.map(h => h.totalCost);
    const colors = holdings.map((_, i) => Utils.chartColor(i));

    _instances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: colors.map(c => c + 'CC'),
          borderWidth: 2,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 12,
              font: { size: 12 },
              usePointStyle: true,
              pointStyleWidth: 10,
              generateLabels: (chart) => {
                const total = data.reduce((s, v) => s + v, 0);
                return chart.data.labels.map((label, i) => ({
                  text: `${label}  ${(data[i] / total * 100).toFixed(1)}%`,
                  fillStyle: colors[i],
                  strokeStyle: colors[i],
                  pointStyle: 'circle',
                  index: i,
                }));
              }
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
                const pct = (ctx.raw / total * 100).toFixed(1);
                const fmt = currency === 'USD' ? Utils.formatUSD(ctx.raw) : Utils.formatTWD(ctx.raw);
                return ` ${fmt} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // ── P&L Timeline Line Chart ─────────────────────────────────────
  function renderPnLLine(canvasId, timeline, currency = 'TWD') {
    destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (!timeline || timeline.length === 0) {
      canvas.parentElement.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📈</div><div class="empty-state-text">尚無損益資料</div></div>`;
      return;
    }

    const fmt = currency === 'USD' ? Utils.formatUSD : Utils.formatTWD;

    _instances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: timeline.map(t => t.label),
        datasets: [
          {
            label: '累計損益',
            data: timeline.map(t => t.cumulativePnL),
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59,130,246,0.08)',
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true,
            tension: 0.3,
          },
          {
            label: '交易損益',
            data: timeline.map(t => t.tradePnL),
            borderColor: '#10B981',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [4, 3],
            pointRadius: 3,
            fill: false,
            tension: 0.3,
          },
          {
            label: '股息收入',
            data: timeline.map(t => t.dividendIncome),
            borderColor: '#8B5CF6',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [6, 3],
            pointRadius: 3,
            fill: false,
            tension: 0.3,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { usePointStyle: true, font: { size: 12 }, padding: 16 }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.raw, true)}`
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 11 },
              callback: (v) => fmt(v)
            }
          }
        }
      }
    });
  }

  // ── Monthly Cash Flow Bar Chart ─────────────────────────────────
  function renderMonthlyCashFlow(canvasId, months) {
    destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (!months || months.length === 0) {
      canvas.parentElement.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">尚無收支資料</div></div>`;
      return;
    }

    _instances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [
          {
            label: '收入',
            data: months.map(m => m.income),
            backgroundColor: 'rgba(16,185,129,0.75)',
            borderColor: '#10B981',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: '支出',
            data: months.map(m => m.expense),
            backgroundColor: 'rgba(239,68,68,0.75)',
            borderColor: '#EF4444',
            borderWidth: 1,
            borderRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { usePointStyle: true, font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${Utils.formatTWD(ctx.raw)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 11 },
              callback: (v) => Utils.formatTWD(v)
            }
          }
        }
      }
    });
  }

  // ── Category Donut Chart ────────────────────────────────────────
  function renderCategoryDonut(canvasId, categoryData) {
    destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (!categoryData || categoryData.length === 0) {
      canvas.parentElement.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🗂️</div><div class="empty-state-text">尚無資料</div></div>`;
      return;
    }

    const labels = categoryData.map(c => c.category);
    const data   = categoryData.map(c => c.amount);
    const colors = categoryData.map((_, i) => Utils.chartColor(i));

    _instances[canvasId] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '55%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: { size: 11 },
              padding: 8,
              generateLabels: (chart) => {
                const total = data.reduce((s, v) => s + v, 0);
                return chart.data.labels.map((label, i) => ({
                  text: `${label} ${(data[i] / total * 100).toFixed(0)}%`,
                  fillStyle: colors[i],
                  strokeStyle: colors[i],
                  pointStyle: 'circle',
                  index: i,
                }));
              }
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
                return ` ${Utils.formatTWD(ctx.raw)} (${(ctx.raw/total*100).toFixed(1)}%)`;
              }
            }
          }
        }
      }
    });
  }

  return {
    renderHoldingsPie,
    renderPnLLine,
    renderMonthlyCashFlow,
    renderCategoryDonut,
    destroy,
  };
})();
