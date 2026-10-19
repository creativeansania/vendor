'use client';

import { CheckCircle2 } from 'lucide-react';

export default function SewingSubmitBar({
  canEditResult,
  saving,
  totalYieldPcs,
  onSubmit
}) {
  if (!canEditResult) return null;

  return (
    <div className="sticky-bottom-action">
      <button
        type="button"
        disabled={saving || totalYieldPcs <= 0}
        onClick={onSubmit}
        className="btn btn-primary"
        style={{ width: '100%', padding: '14px 20px', fontSize: '1rem', borderRadius: '14px' }}
      >
        <CheckCircle2 size={18} />
        <span>{saving ? 'Menyimpan...' : 'Simpan Hasil Jahit'}</span>
      </button>
    </div>
  );
}
