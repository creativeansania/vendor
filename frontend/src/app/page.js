'use client';

import { useRouter } from 'next/navigation';
import { useDashboardOrders } from '@/lib/hooks/useDashboardOrders';
import InstallPwaPrompt from '@/components/InstallPwaPrompt';
import DashboardNavbar from '@/components/dashboard/DashboardNavbar';
import DashboardMetricsGrid from '@/components/dashboard/DashboardMetricsGrid';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import DashboardContextBanners from '@/components/dashboard/DashboardContextBanners';
import DashboardOrderList from '@/components/dashboard/DashboardOrderList';

export default function DashboardPage() {
  const router = useRouter();
  const {
    user,
    vendors,
    loading,
    search,
    setSearch,
    status,
    setStatus,
    selectedVendor,
    setSelectedVendor,
    sort,
    setSort,
    period,
    setPeriod,
    backorderFilter,
    setBackorderFilter,
    page,
    setPage,
    totalPages,
    totalCount,
    metrics,
    hasActiveFilters,
    activeKainKurangBadge,
    displayedOrders,
    pageNumbers,
    handleSearchSubmit,
    handleClearSearch,
    handleToggleStatus,
    handleResetFilters,
    handlePageChange,
    handleAskWaFromCard
  } = useDashboardOrders();

  if (!user) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', overflowX: 'clip' }}>
      {/* Top Navigation */}
      <DashboardNavbar user={user} />

      {/* Main Container */}
      <main className="main-content">
        {/* PWA Home Screen Install Banner for Older Operators */}
        <InstallPwaPrompt />

        {/* KPI Summary Cards (Interactive Filters) */}
        <DashboardMetricsGrid
          metrics={metrics}
          totalCount={totalCount}
          status={status}
          onToggleStatus={handleToggleStatus}
        />

        {/* Toolbar: Search & Extended Filter Controls */}
        <DashboardFilters
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={handleSearchSubmit}
          onClearSearch={handleClearSearch}
          vendors={vendors}
          selectedVendor={selectedVendor}
          onSelectVendor={(v) => {
            setSelectedVendor(v);
            setPage(1);
          }}
          sort={sort}
          onSortChange={(s) => {
            setSort(s);
            setPage(1);
          }}
          period={period}
          onPeriodChange={(p) => {
            setPeriod(p);
            setPage(1);
          }}
          backorderFilter={backorderFilter}
          onBackorderFilterChange={(b) => {
            setBackorderFilter(b);
            setPage(1);
          }}
          hasActiveFilters={hasActiveFilters}
          totalCount={totalCount}
          status={status}
          onResetFilters={handleResetFilters}
          metrics={metrics}
          activeKainKurangBadge={activeKainKurangBadge}
          onToggleStatus={handleToggleStatus}
        />

        {/* Status Context Banners */}
        <DashboardContextBanners
          status={status}
          totalCount={totalCount}
          onClearStatus={() => {
            setStatus('all');
            setPage(1);
          }}
        />

        {/* Orders Grid & Numbered Pagination */}
        <DashboardOrderList
          loading={loading}
          orders={displayedOrders}
          status={status}
          search={search}
          onClearSearch={handleClearSearch}
          onClearStatus={() => {
            setStatus('all');
            setPage(1);
          }}
          onSelectOrder={(id) => router.push(`/orders/${id}`)}
          onAskWa={handleAskWaFromCard}
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageNumbers={pageNumbers}
          onPageChange={handlePageChange}
        />
      </main>
    </div>
  );
}
