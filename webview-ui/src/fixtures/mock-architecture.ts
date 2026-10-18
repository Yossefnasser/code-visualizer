/**
 * ============================================================================
 *  MOCK DATA — fixture/demo data for Milestone 1.
 *
 *  This file contains hand-written example data, NOT analyzer output. It exists
 *  only so the React Flow UI can be developed and demonstrated before the
 *  Python analyzer is implemented (see docs/ROADMAP.md, Milestone 1).
 *
 *  The shape follows `docs/ARCHITECTURE_DATA_MODEL.md` so the same rendering
 *  code can later consume real analyzer output.
 * ============================================================================
 */
import type { ArchitectureGraph } from '@/types/architecture';

/** Banner text shown in the UI whenever this fixture graph is rendered. */
export const MOCK_DATA_NOTE = 'Mock data — Milestone 1 fixture, not analyzer output';

export const MOCK_GRAPH: ArchitectureGraph = {
  schemaVersion: '1.0',
  project: { root: '.', language: 'python' },
  nodes: [
    {
      id: 'endpoint:app.api.users:list_users',
      type: 'endpoint',
      label: 'GET /users',
      details: {
        method: 'GET',
        path: '/users',
        handler: 'list_users',
      },
      source: {
        path: 'app/api/users.py',
        startLine: 12,
        endLine: 18,
      },
      evidence: [
        {
          kind: 'fastapi_route_decorator',
          description: 'FastAPI route decorator discovered by static analysis (mock fixture)',
        },
      ],
    },
    {
      id: 'service:app.services.user_service:list_users',
      type: 'service',
      label: 'list_users',
      details: {
        module: 'app.services.user_service',
        function: 'list_users',
      },
      source: {
        path: 'app/services/user_service.py',
        startLine: 20,
        endLine: 38,
      },
      evidence: [
        {
          kind: 'function_definition',
          description: 'Service function definition (mock fixture)',
        },
      ],
    },
    {
      id: 'database_model:app.models.user:User',
      type: 'database_model',
      label: 'User',
      details: {
        table: 'users',
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'email', type: 'VARCHAR(255)' },
          { name: 'created_at', type: 'TIMESTAMP' },
        ],
      },
      source: {
        path: 'app/models/user.py',
        startLine: 8,
        endLine: 24,
      },
      evidence: [
        {
          kind: 'sqlalchemy_model',
          description: 'SQLAlchemy model class (mock fixture)',
        },
      ],
    },
  ],
  edges: [
    {
      id: 'route_handler:endpoint:app.api.users:list_users->service:app.services.user_service:list_users',
      source: 'endpoint:app.api.users:list_users',
      target: 'service:app.services.user_service:list_users',
      type: 'route_handler',
      status: 'confirmed',
      evidence: [
        {
          kind: 'function_call',
          description: 'Handler contains a call to the resolved service function (mock fixture)',
          source: {
            path: 'app/api/users.py',
            startLine: 16,
            endLine: 16,
          },
        },
      ],
    },
    {
      id: 'uses_model:service:app.services.user_service:list_users->database_model:app.models.user:User',
      source: 'service:app.services.user_service:list_users',
      target: 'database_model:app.models.user:User',
      type: 'uses_model',
      status: 'inferred',
      evidence: [
        {
          kind: 'sqlalchemy_query',
          description: 'Service appears to query the model (mock fixture)',
          source: {
            path: 'app/services/user_service.py',
            startLine: 27,
            endLine: 27,
          },
        },
      ],
    },
  ],
  diagnostics: [],
};
