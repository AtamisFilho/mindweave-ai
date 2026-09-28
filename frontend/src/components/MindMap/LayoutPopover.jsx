import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';
import Select from '../UI/Select';
import { computeLayout, LAYOUT_SCHEMAS } from '../../layout/engine';
import { useReactFlow } from '@xyflow/react';

// Mini-SVG autoral de um preset (estilo × densidade): raiz + 3 filhos
function PresetThumb({ edgeStyle, compact, active, onClick, label }) {
  const W = 64;
  const H = compact ? 46 : 40;
  const stroke = active ? '#2563eb' : '#94a3b8';
  const fill = active ? '#3b82f6' : '#94a3b8';
  const root = { x: 4, y: H / 2 - 5, w: 14, h: 10 };
  const childW = compact ? 12 : 16;
  const childH = compact ? 8 : 10;
  const childY = compact
    ? [3, H / 2 - childH / 2, H - 3 - childH] // list: empilhados
    : [6, H / 2 - childH / 2, H - 6 - childH]; // tree: centro + extremos
  const childX = W - childW - 4;

  const path = (fromY, toY) => {
    const x1 = root.x + root.w;
    const x2 = childX;
    const y1 = fromY;
    if (edgeStyle === 'direct') return `M${x1} ${y1} L${x2} ${toY + childH / 2}`;
    if (edgeStyle === 'cornered') {
      const mid = (x1 + x2) / 2;
      return `M${x1} ${y1} H${mid} V${toY + childH / 2} H${x2}`;
    }
    return `M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${toY + childH / 2}, ${x2} ${toY + childH / 2}`;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`rounded border p-1 transition-colors ${
        active
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
          : 'border-gray-200 dark:border-gray-600 hover:border-blue-300'
      }`}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {childY.map((y, i) => (
          <path key={i} d={path(root.y + root.h / 2, y)} fill="none" stroke={stroke} strokeWidth="1.2" />
        ))}
        <rect x={root.x} y={root.y} width={root.w} height={root.h} rx="2" fill={fill} />
        {childY.map((y, i) => (
          <rect key={i} x={childX} y={y} width={childW} height={childH} rx="1.5" fill={fill} opacity="0.85" />
        ))}
      </svg>
    </button>
  );
}

const EDGE_STYLES = [
  { value: null, label: 'Curved (bezier)' },
  { value: 'straight', label: 'Direct (reta)' },
  { value: 'smoothstep', label: 'Cornered (cantos)' },
];

// Popover do layout (v0.5 B3): grade estilo × densidade, direção, Free-form e Auto.
const LayoutPopover = () => {
  const {
    nodes, edges, layoutMeta, autoLayout,
    applyLayoutPositions, setVisualPreset, setLayoutSchema, setAutoLayout,
  } = useMindMapStore(useShallow((state) => ({
    nodes: state.nodes,
    edges: state.edges,
    layoutMeta: state.layoutMeta,
    autoLayout: state.autoLayout,
    applyLayoutPositions: state.applyLayoutPositions,
    setVisualPreset: state.setVisualPreset,
    setLayoutSchema: state.setLayoutSchema,
    setAutoLayout: state.setAutoLayout,
  })));
  const { fitView } = useReactFlow();
  const [open, setOpen] = useState(false);

  const applyPositions = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const positions = computeLayout(nodes, edges, { schema: layoutMeta.schema });
    applyLayoutPositions(positions);
    setTimeout(() => fitView({ duration: reduced ? 0 : 300, padding: 0.2 }), reduced ? 30 : 380);
  };

  const edgeStyleLabel = (value) => (EDGE_STYLES.find((s) => s.value === value) ?? EDGE_STYLES[0]).label.split(' ')[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg px-2 py-1.5 hover:border-blue-300"
        title="Esquemas de layout, estilo de aresta e densidade"
      >
        ⚡ Layout ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 rounded-md shadow-xl border border-gray-200 dark:border-gray-700 z-50 p-3 space-y-3">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Esquema visual</p>
            <div className="grid grid-cols-3 gap-1.5">
              {EDGE_STYLES.map((style) =>
                [false, true].map((compact) => (
                  <PresetThumb
                    key={`${style.value}-${compact}`}
                    edgeStyle={style.value ?? 'curved'}
                    compact={compact}
                    active={(layoutMeta.edgeType ?? null) === style.value && layoutMeta.compact === compact}
                    onClick={() => {
                      setVisualPreset({ edgeType: style.value, compact });
                      toast.success(`Estilo: ${edgeStyleLabel(style.value)} · ${compact ? 'lista' : 'árvore'}`);
                    }}
                    label={`${style.label} · ${compact ? 'lista' : 'árvore'}`}
                  />
                )),
              )}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Direção (posições)</p>
            <Select
              value={layoutMeta.schema}
              onChange={(e) => { setLayoutSchema(e.target.value); }}
              options={LAYOUT_SCHEMAS}
              className="w-full text-xs"
              aria-label="Schema do layout"
            />
            <Button onClick={applyPositions} variant="primary" className="w-full text-xs py-1 mt-1.5">
              ⚡ Aplicar posições agora
            </Button>
          </div>

          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-2">
            <button
              onClick={() => { setAutoLayout(!autoLayout); if (!autoLayout) applyPositions(); }}
              className={`text-xs px-2 py-1 rounded ${autoLayout ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              title="Reorganiza automaticamente após adicionar/remover/conectar nós"
            >
              Auto: {autoLayout ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => {
                setVisualPreset({ edgeType: null, compact: false });
                toast.success('Free-form: organize manualmente');
              }}
              className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
              title="Congela as posições atuais e limpa o estilo de aresta"
            >
              ↺ Free-form
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayoutPopover;
