'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function DashboardPagination({
  page,
  totalPages,
  pageNumbers = [],
  onPageChange
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination-wrapper">
      <div className="pagination-list">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="pagination-item pagination-item-nav"
          title="Halaman Sebelumnya"
        >
          <ChevronLeft size={16} />
          <span className="hide-on-mobile">Prev</span>
        </button>

        {pageNumbers.map((pItem, idx) => {
          if (pItem === '...') {
            return (
              <span key={`dots-${idx}`} className="pagination-ellipsis">
                •••
              </span>
            );
          }
          const isCurrent = pItem === page;
          return (
            <button
              key={`page-${pItem}`}
              onClick={() => onPageChange(pItem)}
              className={`pagination-item ${isCurrent ? 'active' : ''}`}
            >
              {pItem}
            </button>
          );
        })}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="pagination-item pagination-item-nav"
          title="Halaman Berikutnya"
        >
          <span className="hide-on-mobile">Next</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

