import React, { useEffect, useRef, useState } from 'react';
import useMindMapStore from '../../store/mindMapStore';
import Button from '../UI/Button';
import Input from '../UI/Input';

// Modal de geração de mapa (v0.4.5 B3): tópico + profundidade + largura.
// Cria um MAPA NOVO (nunca sobrepõe o atual) — não-destrutivo por construção.
const DEPTH_OPTIONS = [
  { value: '2', label: '2 níveis (visão geral)' },
  { value: '3', label: '3 níveis (detalhado)' },
];
const BREADTH_OPTIONS = [
  { value: '3', label: '3 por ramo' },
  { value: '4', label: '4 por ramo' },
  { value: '5', label: '5 por ramo' },
];

const GenerateMapModal = ({ open, onClose }) => {
  const generatingMap = useMindMapStore((s) => s.generatingMap);
  const [topic, setTopic] = useState('');
  const [depth, setDepth] = useState('3');
  const [breadth, setBreadth] = useState('4');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTopic('');
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const clean = topic.trim();
    if (!clean || generatingMap) return;
    setError('');
    await useMindMapStore.getState().generateMap(clean, Number(depth), Number(breadth));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-label="Gerar mapa a partir de um tópico"
    >
      <form
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-[92%] max-w-md"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3 className="text-lg font-semibold mb-1 text-gray-800 dark:text-gray-100">
          ✨ Gerar mapa a partir de um tópico
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          A IA cria um mapa NOVO — o mapa atual permanece intacto no menu Mapas.
        </p>

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
          Tópico central
        </label>
        <Input
          ref={inputRef}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="ex: Energias renováveis no Brasil"
          className="w-full text-sm mb-3"
          maxLength={120}
        />

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Profundidade
            </label>
            <select
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              className="w-full text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            >
              {DEPTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
              Largura por ramo
            </label>
            <select
              value={breadth}
              onChange={(e) => setBreadth(e.target.value)}
              className="w-full text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
            >
              {BREADTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose} variant="outline" className="text-xs py-1">
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={generatingMap || !topic.trim()} className="text-xs py-1">
            {generatingMap ? 'Gerando…' : '✨ Gerar mapa'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default GenerateMapModal;
