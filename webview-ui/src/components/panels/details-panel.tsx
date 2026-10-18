import type { ArchitectureNode } from '@/types/architecture';

interface DetailsPanelProps {
  node: ArchitectureNode | null;
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'object' && item !== null && 'name' in item)) {
    return value.map((item) => String((item as { name: unknown }).name)).join(', ');
  }
  return JSON.stringify(value);
}

function formatSource(node: ArchitectureNode): string | null {
  const source = node.source;
  if (!source) {
    return null;
  }
  const range = source.endLine !== undefined ? `${source.startLine}-${source.endLine}` : `${source.startLine}`;
  return `${source.path}:${range}`;
}

export function DetailsPanel({ node }: DetailsPanelProps) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-background p-3 text-left">
      <h2 className="mb-2 text-sm font-semibold text-foreground">Details</h2>
      {!node ? (
        <p className="text-xs text-muted-foreground">Select a node to inspect its details.</p>
      ) : (
        <div className="flex flex-col gap-3 text-xs">
          <div>
            <p className="font-semibold text-foreground">{node.label}</p>
            <p className="text-muted-foreground">{node.type}</p>
          </div>

          <div>
            <p className="mb-1 font-semibold text-foreground">ID</p>
            <p className="break-all font-mono text-muted-foreground">{node.id}</p>
          </div>

          {node.details && Object.keys(node.details).length > 0 ? (
            <div>
              <p className="mb-1 font-semibold text-foreground">Details</p>
              <dl className="flex flex-col gap-1">
                {Object.entries(node.details).map(([key, value]) => (
                  <div key={key} className="flex flex-col">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="break-words text-foreground">{formatDetailValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {formatSource(node) ? (
            <div>
              <p className="mb-1 font-semibold text-foreground">Source</p>
              <p className="font-mono text-muted-foreground">{formatSource(node)}</p>
            </div>
          ) : null}

          {node.evidence && node.evidence.length > 0 ? (
            <div>
              <p className="mb-1 font-semibold text-foreground">Evidence</p>
              <ul className="flex flex-col gap-1">
                {node.evidence.map((entry) => (
                  <li key={entry.kind} className="text-muted-foreground">
                    <span className="font-mono text-foreground">{entry.kind}</span>: {entry.description}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
