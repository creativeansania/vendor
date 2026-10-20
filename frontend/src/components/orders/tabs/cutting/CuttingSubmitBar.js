'use client';

import { Save } from 'lucide-react';

export default function CuttingSubmitBar({
  canEditCutting,
  saving,
  actualCutting,
  totalPhysicalFabric,
  rollWeights = {},
  label = 'Simpan Hasil Potong',
  onSubmit
}) {
  if (!canEditCutting) return null;

  const isDisabled =
    saving ||
    (actualCutting === '' && totalPhysicalFabric <= 0 && Object.keys(rollWeights).length === 0);

  return (
    <div className="sticky-bottom-action">
      <button
        type="button"
        disabled={isDisabled}
        onClick={onSubmit}
        className="btn btn-primary"
        style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', borderRadius: '14px' }}
      >
        <Save size={18} />
        <span>{saving ? 'Menyimpan...' : label}</span>
      </button>
    </div>
  );
}
