import { Position, type Node, type NodeProps } from '@xyflow/react';

import { BaseHandle } from '@/components/base-handle';
import {
  BaseNode,
  BaseNodeContent,
  BaseNodeHeader,
  BaseNodeHeaderTitle,
} from '@/components/base-node';
import { cn } from '@/lib/utils';
import type { ArchitectureNodeData } from '@/types/architecture';

export type EndpointFlowNode = Node<ArchitectureNodeData, 'endpoint'>;

interface EndpointDetails {
  method?: string;
  path?: string;
  handler?: string;
}

export function EndpointNode({ data }: NodeProps<EndpointFlowNode>) {
  const details = (data.node.details ?? {}) as EndpointDetails;

  return (
    <BaseNode className="w-56">
      <BaseHandle type="source" position={Position.Right} />
      <BaseNodeHeader className="border-b p-2">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground',
            details.method === 'GET' && 'bg-emerald-100 text-emerald-800',
            details.method === 'POST' && 'bg-blue-100 text-blue-800',
            details.method !== 'GET' && details.method !== 'POST' && 'bg-muted',
          )}
        >
          {details.method ?? 'GET'}
        </span>
        <BaseNodeHeaderTitle className="truncate font-mono text-xs" title={details.path ?? data.node.label}>
          {details.path ?? data.node.label}
        </BaseNodeHeaderTitle>
      </BaseNodeHeader>
      {details.handler ? (
        <BaseNodeContent className="p-2">
          <p className="truncate font-mono text-xs text-muted-foreground" title={details.handler}>
            handler: {details.handler}
          </p>
        </BaseNodeContent>
      ) : null}
    </BaseNode>
  );
}

