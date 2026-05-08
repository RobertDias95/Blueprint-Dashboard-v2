// Q2: Skeleton placeholders for loading states. One primitive, two presets.
// `Skeleton` is a single shimmering bar. `SkeletonRows` stacks N of them.

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-s2 rounded ${className}`}
      data-testid="skeleton"
    />
  );
}

interface SkeletonRowsProps {
  count?: number;
  rowClassName?: string;
  className?: string;
}

export function SkeletonRows({
  count = 4,
  rowClassName = 'h-12',
  className = '',
}: SkeletonRowsProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={rowClassName} />
      ))}
    </div>
  );
}
