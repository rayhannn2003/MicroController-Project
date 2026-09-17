import { useId, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { IconTable } from '../../components/ui/Icons';

/** A chart card with an always-available text summary and a table alternative. */
export function ChartSection({
  id,
  title,
  description,
  summary,
  chart,
  table,
  controls,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  summary: string;
  chart: ReactNode;
  table: ReactNode;
  controls?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <Card aria-labelledby={`${id}-heading`}>
      <CardHeader
        id={`${id}-heading`}
        title={title}
        description={description}
        actions={
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showTable}
            aria-controls={tableId}
            onClick={() => {
              setShowTable((value) => !value);
            }}
          >
            <IconTable size={16} />
            {showTable ? 'View as chart' : 'View as table'}
          </Button>
        }
      />
      <div className="space-y-3 p-4 sm:p-6">
        <p className="text-sm text-ink-muted">{summary}</p>
        {controls}
        <div id={tableId}>{showTable ? table : <div aria-hidden="true">{chart}</div>}</div>
      </div>
    </Card>
  );
}

export function ChartPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ height }}
      className="w-full animate-shimmer rounded-md bg-surface-muted"
    />
  );
}
