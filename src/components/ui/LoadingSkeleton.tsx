import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      className={clsx('skeleton', className)}
      style={{ width, height }}
    />
  );
}

export function ChartSkeleton() {
  return (
    <div className="w-full h-full flex flex-col gap-2 p-4">
      <div className="flex gap-2 mb-2">
        {['1D','1W','1M','3M','1Y','ALL'].map(r => (
          <Skeleton key={r} width={40} height={28} />
        ))}
      </div>
      <Skeleton className="flex-1 w-full" />
    </div>
  );
}

export function PriceHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-6">
      <div className="flex items-center gap-3">
        <Skeleton width={60} height={28} />
        <Skeleton width={50} height={22} />
        <Skeleton width={180} height={24} />
      </div>
      <div className="flex items-center gap-3 mt-1">
        <Skeleton width={100} height={40} />
        <Skeleton width={120} height={28} />
        <Skeleton width={100} height={20} />
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--bg-elevated)' }}>
      <Skeleton width={80} height={14} className="mb-2" />
      <Skeleton width={120} height={24} />
    </div>
  );
}

export function InsiderRowSkeleton() {
  return (
    <div className="flex gap-4 p-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      <Skeleton width={80} height={14} />
      <Skeleton width={140} height={14} />
      <Skeleton width={80} height={14} />
      <Skeleton width={50} height={20} className="rounded" />
      <Skeleton width={70} height={14} />
      <Skeleton width={70} height={14} />
      <Skeleton width={80} height={14} />
    </div>
  );
}
