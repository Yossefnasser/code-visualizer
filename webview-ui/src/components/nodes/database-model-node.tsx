import { Position, type Node, type NodeProps } from '@xyflow/react';

import { BaseHandle } from '@/components/base-handle';
import { BaseNode, BaseNodeContent } from '@/components/base-node';
import type { ArchitectureNodeData } from '@/types/architecture';

export type DatabaseModelFlowNode = Node<ArchitectureNodeData, 'database_model'>;

interface DatabaseModelDetails {
  table?: string;
  columns?: Array<{ name: string; type: string }>;
}

export function DatabaseModelNode({ data }: NodeProps<DatabaseModelFlowNode>) {
  const details = (data.node.details ?? {}) as DatabaseModelDetails;
  const columns = details.columns ?? [];

  return (
    <BaseNode className="w-56 overflow-hidden">
      <BaseHandle type="target" position={Position.Left} />
      {/* Cylinder-like top so the node reads as a database table/model. */}
      <div className="rounded-t-[999px] bg-muted px-4 pt-1.5 pb-1.5 text-center">
        <h2 className="truncate text-sm font-semibold text-foreground" title={data.node.label}>
          {data.node.label}
        </h2>
        {details.table ? (
          <p className="truncate text-[10px] text-muted-foreground" title={details.table}>
            table: {details.table}
          </p>
        ) : null}
      </div>
      <BaseNodeContent className="p-0">
        {columns.length > 0 ? (
          <ul className="w-full divide-y divide-border px-3 py-1 text-left">
            {columns.map((column) => (
              <li key={column.name} className="flex items-center justify-between gap-2 py-0.5 text-xs">
                <span className="font-mono text-foreground">{column.name}</span>
                <span className="text-muted-foreground">{column.type}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </BaseNodeContent>
    </BaseNode>
  );
}
