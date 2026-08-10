import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Crown,
  Network,
  Search,
  Shield,
  Users,
  X,
} from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageErrorState, PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { userApi, roleApi } from '@/services/api';
import { getRoleColor } from '@/lib/roleColors';

/* ── Types ── */

type SimpleGroup = { id: number; name: string; slug?: string | null };

type OrgUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  role_id: number | null;
  role_name: string;
  role_color: string;
  hierarchy_level: number;
  reporting_manager_id: number | null;
  department: string;
  department_id: number | null;
  team: { id: number; name: string; is_manager: boolean } | null;
  created_at?: string;
  groups?: SimpleGroup[];
};

type ConnectorSeg = { path: string; team: boolean; id: NodeId };

/**
 * A parent whose children are ALL leaves gets its children stacked in a vertical
 * column instead of spread across a row. Fanning eight leaf cards sideways is
 * what forces the horizontal scrolling; stacking them costs one card of width.
 * Only applied from three children up — one or two side by side still reads
 * better as a row.
 */
const STACK_LEAVES_FROM = 3;

/**
 * Shared by the renderer and the connector drawer so both agree on which
 * branches are stacked — they must, or the lines land in the wrong place.
 */
const shouldStackChildren = (
  children: ReadonlyArray<{ id: NodeId }>,
  childrenMap: Map<any, ReadonlyArray<unknown>>,
): boolean =>
  children.length >= STACK_LEAVES_FROM
  && children.every((c) => (childrenMap.get(c.id)?.length ?? 0) === 0);

/* ── Helpers ── */

const initials = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length <= 1) return (parts[0] || '').slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const matchUser = (u: OrgUser, q: string) =>
  !q ||
  u.name.toLowerCase().includes(q) ||
  (u.email && u.email.toLowerCase().includes(q)) ||
  u.department?.toLowerCase().includes(q) ||
  (u.groups?.some((g) => g.name.toLowerCase().includes(q)) ?? false);

const deptLabel = (d: string) => d || 'Unassigned';

/**
 * Parent-bottom to child-top connector with rounded elbows. Hard right angles
 * at 2px read as a wireframe; the soft corners are what BambooHR-class charts
 * use and they make dense sibling rows much easier to follow by eye.
 */
/**
 * Connector for a STACKED (vertically listed) child: a spine dropping from the
 * parent, then a short stub into the card's left edge. This is the shape every
 * hybrid org-chart layout uses for leaf columns.
 */
const stackPath = (spineX: number, parentBottom: number, childLeft: number, childCy: number) => {
  const r = Math.min(10, Math.max(0, (childLeft - spineX) / 2), Math.max(0, (childCy - parentBottom) / 2));

  return [
    `M ${spineX} ${parentBottom}`,
    `L ${spineX} ${childCy - r}`,
    `Q ${spineX} ${childCy} ${spineX + r} ${childCy}`,
    `L ${childLeft} ${childCy}`,
  ].join(' ');
};

const elbowPath = (x1: number, y1: number, x2: number, y2: number) => {
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;

  if (Math.abs(dx) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;

  const r = Math.min(10, Math.abs(dx) / 2, Math.abs(y2 - y1) / 2);
  const dir = dx > 0 ? 1 : -1;

  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${midY - r}`,
    `Q ${x1} ${midY} ${x1 + dir * r} ${midY}`,
    `L ${x2 - dir * r} ${midY}`,
    `Q ${x2} ${midY} ${x2} ${midY + r}`,
    `L ${x2} ${y2}`,
  ].join(' ');
};

/* ── Tree Node Card ── */

/**
 * Memoised deliberately, with a custom comparison.
 *
 * Hovering a card sets hovered-user state on the page, so React re-renders the
 * whole tree — every node, on every pointer move between cards. On an org of
 * any size that is hundreds of components rebuilt per mouse movement, which
 * drops frames and reads as jitter.
 *
 * A plain memo() would achieve nothing here: cardHandlers() builds fresh arrow
 * functions on every render, so the default shallow compare always sees changed
 * props. The comparator below ignores those handlers — they are rebuilt but
 * behaviourally identical — and re-renders only when something the card
 * actually draws has changed. In practice that is the two nodes whose
 * `emphasize` flipped.
 */
function TreeNodeCardBase({
  user, count, isCollapsed, onToggle, groupNames, matched, simple, emphasize, onMouseEnter, onMouseLeave, onClick,
}: {
  user: OrgUser;
  count?: number; isCollapsed?: boolean; onToggle?: () => void;
  groupNames?: string[]; matched?: boolean;
  simple?: boolean; emphasize?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
}) {
  const t = getRoleColor(user.role_color, user.hierarchy_level);
  const dept = deptLabel(user.department);

  /*
    Card layout follows the pattern shared by BambooHR / Pingboard-style org
    charts: a narrow centred card — avatar, name, one line of role — and the
    direct-report count as a chip SITTING ON the connector line beneath the
    card, doubling as the expand/collapse control. Everything else (department,
    team, groups) appears only in Detailed view; repeating "Marketing ·
    EMPLOYEE · No reports" on every one of forty cards was most of the
    congestion. The card stays the identity; the tree carries the structure.

    transition-shadow, not transition-all: hover state re-renders nodes, and
    animating every property on every node drops frames.
  */
  return (
    <div
      data-node-id={user.id}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      className={`relative cursor-pointer rounded-xl border bg-white text-center shadow-sm transition-shadow hover:shadow-md ${
        simple ? 'w-40 px-2.5 pb-3.5 pt-3' : 'w-44 px-3 pb-4 pt-3'
      } ${t.border} ${
        matched === false ? 'opacity-40' : ''
      } ${matched ? 'ring-2 ring-sky-400' : ''} ${
        emphasize ? 'border-indigo-400 ring-2 ring-indigo-300 shadow-md' : ''
      }`}
    >
      <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold ${t.avatar}`}>
        {initials(user.name)}
      </div>

      <p className="mt-1.5 truncate text-[13px] font-semibold leading-tight text-slate-900" title={user.name}>
        {user.name}
      </p>

      <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
        {user.role_name}
        {user.team?.is_manager ? ' · Lead' : ''}
      </p>

      {!simple && (
        <>
          <p className={`mt-1 truncate text-[11px] ${dept === 'Unassigned' ? 'italic text-slate-400' : 'text-slate-500'}`}>
            {dept === 'Unassigned' ? 'No department' : dept}
          </p>
          {user.team && (
            <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
              <Users className="h-3 w-3 shrink-0" />
              <span className="truncate">{user.team.name}</span>
            </span>
          )}
          {groupNames && groupNames.filter((g) => g !== dept).length > 0 && (
            <p className="mt-0.5 truncate text-[10px] font-medium text-indigo-500">
              {groupNames.filter((g) => g !== dept).join(', ')}
            </p>
          )}
        </>
      )}

      {/* The expand/collapse chip lives on the connector line, so the control
          for a subtree is exactly where the subtree hangs. stopPropagation so
          toggling never also pins the card. */}
      {onToggle && typeof count === 'number' && count > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={isCollapsed ? `Expand ${count} reports` : `Collapse ${count} reports`}
          className="absolute -bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600 shadow-sm transition-colors hover:border-sky-300 hover:text-sky-700"
        >
          {count}
          <ChevronDown className={`h-3 w-3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} />
        </button>
      )}
    </div>
  );
}

const TreeNodeCard = memo(TreeNodeCardBase, (prev, next) => (
  prev.user === next.user
  && prev.count === next.count
  && prev.isCollapsed === next.isCollapsed
  && prev.matched === next.matched
  && prev.simple === next.simple
  && prev.emphasize === next.emphasize
  // groupNames is rebuilt per render, so compare contents rather than identity.
  && (prev.groupNames ?? []).join(' ') === (next.groupNames ?? []).join(' ')
));

/* ── Recursive Subordinate Tree ── */

function SubordinateTree({
  parentId,
  depth,
  childrenMap,
  collapsed,
  onToggle,
  q,
  simple,
  onHoverUser,
  onPinUser,
}: {
  parentId: number;
  depth: number;
  childrenMap: Map<number, OrgUser[]>;
  collapsed: Set<NodeId>;
  onToggle: (id: NodeId) => void;
  q: string;
  simple?: boolean;
  onHoverUser?: (id: number) => void;
  onPinUser?: (id: number) => void;
}) {
  const children = childrenMap.get(parentId) ?? [];
  if (children.length === 0) return null;

  const visibleChildren = q
    ? children.filter((c) => {
        const selfMatch = matchUser(c, q);
        const hasVisibleDescendant = (pid: number): boolean => {
          const subs = childrenMap.get(pid) ?? [];
          return subs.some((s) => matchUser(s, q) || hasVisibleDescendant(s.id));
        };
        return selfMatch || hasVisibleDescendant(c.id);
      })
    : children;

  if (visibleChildren.length === 0) return null;

  // Order by hierarchy level (team managers above members naturally).
  const sorted = [...visibleChildren].sort((a, b) => a.hierarchy_level - b.hierarchy_level);

  // Group siblings that share a team.id into a visible team band.
  // Teams with a single member (or no team) are rendered as individual cards.
  type Row =
    | { kind: 'user'; user: OrgUser }
    | { kind: 'band'; team: { id: number; name: string }; users: OrgUser[] };

  const rows: Row[] = [];
  if (simple) {
    // Simple view: every person is an individual card (no team band boxes).
    sorted.forEach((u) => rows.push({ kind: 'user', user: u }));
  } else {
    // Detailed view: group siblings sharing a team.id into a visible band box.
    const teamGroups = new Map<number, OrgUser[]>();
    const loose: OrgUser[] = [];
    for (const u of sorted) {
      if (u.team) {
        const arr = teamGroups.get(u.team.id) ?? [];
        arr.push(u);
        teamGroups.set(u.team.id, arr);
      } else {
        loose.push(u);
      }
    }

    for (const [teamId, users] of teamGroups) {
      if (users.length >= 2) {
        rows.push({ kind: 'band', team: { id: teamId, name: users[0].team!.name }, users });
      } else {
        users.forEach((u) => rows.push({ kind: 'user', user: u }));
      }
    }
    loose.forEach((u) => rows.push({ kind: 'user', user: u }));
  }

  rows.sort((a, b) => {
    const la = a.kind === 'band' ? Math.min(...a.users.map((u) => u.hierarchy_level)) : a.user.hierarchy_level;
    const lb = b.kind === 'band' ? Math.min(...b.users.map((u) => u.hierarchy_level)) : b.user.hierarchy_level;
    return la - lb;
  });

  const cardHandlers = (id: number) => ({
    onMouseEnter: onHoverUser ? () => onHoverUser(id) : undefined,
    onMouseLeave: onHoverUser ? () => onHoverUser(-1) : undefined,
    onClick: onPinUser ? () => onPinUser(id) : undefined,
  });

  /*
    No panel around each subtree level. Every generation used to be wrapped in
    its own bordered grey box, so a three-level org rendered boxes inside boxes
    inside boxes — that nesting was the single biggest source of the congested
    look. The connector lines already communicate the structure; only team
    bands keep a (dashed) outline because they mark a real grouping.
  */
  /*
    Hybrid layout. When every child is a leaf, list them in a vertical column
    rather than fanning them across a row — the standard fix for horizontal
    sprawl in org charts (yFiles calls it a stacked branch; dabeng/OrgChart
    calls it hybrid). A manager with eight employees was ~1500px wide and forced
    constant horizontal scrolling; stacked it costs one card of width and reads
    top-to-bottom like a list.
  */
  if (shouldStackChildren(visibleChildren, childrenMap)) {
    return (
      <div className="flex flex-col items-start gap-2 pt-6">
        {sorted.map((child) => (
          <TreeNodeCard
            key={child.id}
            user={child}
            simple={simple}
            count={0}
            matched={q ? matchUser(child, q) : undefined}
            {...cardHandlers(child.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-10 pt-3">
      {rows.map((row) =>
        row.kind === 'band' ? (
          <div
            key={`band-${row.team.id}`}
            className="flex flex-col items-center rounded-xl border border-dashed border-indigo-200 bg-indigo-50/30 p-2.5"
          >
            {/* Team name as a header strip INSIDE the box */}
            <div className="mb-2 flex items-center gap-1.5 rounded-md bg-indigo-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-indigo-700">
              <Users className="h-3.5 w-3.5" />
              {row.team.name}
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              {row.users.map((child) => (
                <div key={child.id} className="flex flex-col items-center gap-8">
                  <TreeNodeCard
                    user={child}
                    simple={simple}
                    count={childrenMap.get(child.id)?.length ?? 0}
                    isCollapsed={collapsed.has(child.id)}
                    onToggle={childrenMap.get(child.id)?.length ? () => onToggle(child.id) : undefined}
                    matched={q ? matchUser(child, q) : undefined}
                    {...cardHandlers(child.id)}
                  />
                  {!collapsed.has(child.id) && (
                    <SubordinateTree
                      parentId={child.id}
                      depth={depth + 1}
                      childrenMap={childrenMap}
                      collapsed={collapsed}
                      onToggle={onToggle}
                      q={q}
                      simple={simple}
                      onHoverUser={onHoverUser}
                      onPinUser={onPinUser}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div key={row.user.id} className="flex flex-col items-center gap-8">
            <TreeNodeCard
              user={row.user}
              simple={simple}
              count={childrenMap.get(row.user.id)?.length ?? 0}
              isCollapsed={collapsed.has(row.user.id)}
              onToggle={childrenMap.get(row.user.id)?.length ? () => onToggle(row.user.id) : undefined}
              matched={q ? matchUser(row.user, q) : undefined}
              {...cardHandlers(row.user.id)}
            />
            {!collapsed.has(row.user.id) && (
              <SubordinateTree
                parentId={row.user.id}
                depth={depth + 1}
                childrenMap={childrenMap}
                collapsed={collapsed}
                onToggle={onToggle}
                q={q}
                simple={simple}
                onHoverUser={onHoverUser}
                onPinUser={onPinUser}
              />
            )}
          </div>
        ),
      )}
    </div>
  );
}

/* ── By Dept tree: Department / Team / User are explicit tree nodes ──
   These reuse the SAME data-node-id + SVG connector mechanism as the
   Simple/Detailed reporting tree — they are intermediate nodes hanging
   off the Admin root, not floating section headers. */

type NodeId = number | string;

type OrgNode =
  | { kind: 'user'; id: number; user: OrgUser }
  | { kind: 'dept'; id: string; name: string; headcount: number }
  | { kind: 'team'; id: string; name: string; headcount: number; deptId: number };

const nodeLevel = (n: OrgNode): number => {
  if (n.kind === 'user') return n.user.hierarchy_level;
  if (n.kind === 'dept') return -2;
  return -1;
};

function DeptNodeCard({ node, isCollapsed, onToggle }: { node: OrgNode & { kind: 'dept' }; isCollapsed?: boolean; onToggle?: () => void }) {
  return (
    <div
      data-node-id={node.id}
      className="flex w-[210px] items-center gap-3 rounded-xl border-2 border-slate-300 bg-white p-3 shadow-sm"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-inverse text-on-inverse">
        <Building2 className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Department</p>
        <p className="truncate text-base font-semibold text-slate-900">{node.name}</p>
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
        {node.headcount}
      </span>
      {onToggle && (
        <button onClick={onToggle} className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function TeamNodeCard({ node, isCollapsed, onToggle }: { node: OrgNode & { kind: 'team' }; isCollapsed?: boolean; onToggle?: () => void }) {
  return (
    <div
      data-node-id={node.id}
      className="flex w-[200px] items-center gap-3 rounded-xl border-2 border-indigo-300 bg-indigo-50/60 p-3 shadow-sm"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <Users className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-500">Team</p>
        <p className="truncate text-sm font-semibold text-slate-900">{node.name}</p>
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">
        {node.headcount}
      </span>
      {onToggle && (
        <button onClick={onToggle} className="shrink-0 rounded p-0.5 text-indigo-400 transition hover:bg-indigo-100 hover:text-indigo-600">
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

/* Recursive renderer for the By Dept tree. Renders Dept / Team / User nodes
   and recurses via the same childrenMap shape the reporting tree uses. */
function DeptSubTree({
  parentId,
  childrenMap,
  collapsed,
  onToggle,
  q,
  onHoverUser,
  onPinUser,
}: {
  parentId: NodeId;
  childrenMap: Map<NodeId, OrgNode[]>;
  collapsed: Set<NodeId>;
  onToggle: (id: NodeId) => void;
  q: string;
  onHoverUser?: (id: number) => void;
  onPinUser?: (id: number) => void;
}) {
  const children = childrenMap.get(parentId) ?? [];
  if (children.length === 0) return null;

  const nodeMatches = (n: OrgNode) => (n.kind === 'user' ? matchUser(n.user, q) : true);
  const hasVisibleDescendant = (id: NodeId): boolean => {
    const kids = childrenMap.get(id) ?? [];
    return kids.some((k) => nodeMatches(k) || hasVisibleDescendant(k.id));
  };

  const visibleChildren = q
    ? children.filter((c) => nodeMatches(c) || hasVisibleDescendant(c.id))
    : children;
  if (visibleChildren.length === 0) return null;

  const sorted = [...visibleChildren].sort((a, b) => nodeLevel(a) - nodeLevel(b));

  const cardHandlers = (id: number) => ({
    onMouseEnter: onHoverUser ? () => onHoverUser(id) : undefined,
    onMouseLeave: onHoverUser ? () => onHoverUser(-1) : undefined,
    onClick: onPinUser ? () => onPinUser(id) : undefined,
  });

  return (
    <div className="flex flex-wrap justify-center gap-8">
      {sorted.map((node) => {
        const childNodes = childrenMap.get(node.id) ?? [];
        const hasChildren = childNodes.length > 0;
        const nodeCollapsed = collapsed.has(node.id);
        return (
          <div key={String(node.id)} className="flex flex-col items-center gap-8">
            {node.kind === 'user' ? (
              <TreeNodeCard
                user={node.user}
                emphasize={node.user.team?.is_manager}
                count={childNodes.length}
                isCollapsed={nodeCollapsed}
                onToggle={hasChildren ? () => onToggle(node.user.id) : undefined}
                matched={q ? matchUser(node.user, q) : undefined}
                {...cardHandlers(node.user.id)}
              />
            ) : node.kind === 'dept' ? (
              <DeptNodeCard
                node={node}
                isCollapsed={nodeCollapsed}
                onToggle={hasChildren ? () => onToggle(node.id) : undefined}
              />
            ) : (
              <TeamNodeCard
                node={node}
                isCollapsed={nodeCollapsed}
                onToggle={hasChildren ? () => onToggle(node.id) : undefined}
              />
            )}

            {hasChildren && !nodeCollapsed && (
              <DeptSubTree
                parentId={node.id}
                childrenMap={childrenMap}
                collapsed={collapsed}
                onToggle={onToggle}
                q={q}
                onHoverUser={onHoverUser}
                onPinUser={onPinUser}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main ── */

export default function OrganizationTree() {
  const { isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [connectors, setConnectors] = useState<ConnectorSeg[]>([]);
  // Geometry of the last connectors we committed. Lets draw() skip the state
  // update when nothing moved, which is what breaks the ResizeObserver loop.
  const connectorSignatureRef = useRef('');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<NodeId>>(new Set());

  /* ── Simple / Detailed / Departments view ── */
  const [view, setView] = useState<'simple' | 'detailed' | 'departments'>('simple');
  const simple = view === 'simple';

  /* ── Reporting breadcrumb (hover preview + click pin) ── */
  const [pinned, setPinned] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const handleHoverUser = (id: number) => setHovered(id === -1 ? null : id);
  const handlePinUser = (id: number) => setPinned(id);

  /* ── Zoom & pan ── */
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panning = useRef(false);
  const panLast = useRef({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

  const clampZoom = (z: number) => Math.min(2, Math.max(0.4, z));

  // NOTE: attached as a NATIVE non-passive listener below (not via JSX onWheel,
  // which React makes passive). If this stays passive, e.preventDefault() is a
  // no-op and the browser's native ctrl+wheel page-zoom fires on top of the
  // canvas zoom — the page keeps rescaling, the connector ResizeObserver
  // redraws every frame, and the canvas appears to "vibrate".
  const onViewportWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('wheel', onViewportWheel, { passive: false });
    return () => el.removeEventListener('wheel', onViewportWheel);
  }, [onViewportWheel]);

  const onViewportMouseDown = (e: ReactMouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    panning.current = true;
    panLast.current = { x: e.clientX, y: e.clientY };
  };

  const onViewportMouseMove = (e: ReactMouseEvent) => {
    if (!panning.current || !scrollRef.current) return;
    const dx = e.clientX - panLast.current.x;
    const dy = e.clientY - panLast.current.y;
    panLast.current = { x: e.clientX, y: e.clientY };
    scrollRef.current.scrollLeft -= dx;
    scrollRef.current.scrollTop -= dy;
  };

  const endPan = () => {
    panning.current = false;
  };

  // Focus/zoom to a node when its connector line is clicked.
  // Runs EXACTLY ONCE per click (invoked from the connector's onClick) — never
  // from a ResizeObserver or a zoom/pan-dependent effect — so it cannot feed its
  // own DOM read back into the zoom state and oscillate (the original bug).
  const focusNode = useCallback(
    (id: NodeId) => {
      const scroll = scrollRef.current;
      const wrap = wrapperRef.current;
      const node = wrap?.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
      if (!scroll || !wrap || !node) return;

      // Guard (fix direction #3): only change zoom if it actually differs.
      const targetZoom = clampZoom(Math.max(zoom, 1.1));
      if (Math.abs(targetZoom - zoom) > 0.01) {
        setZoom(targetZoom);
      }

      // Center the node in the viewport once, on the next frame if we zoomed.
      const center = () => {
        const nodeRect = node.getBoundingClientRect();
        const scrollRect = scroll.getBoundingClientRect();
        const targetLeft =
          scroll.scrollLeft + (nodeRect.left + nodeRect.width / 2 - scrollRect.left) - scrollRect.width / 2;
        const targetTop =
          scroll.scrollTop + (nodeRect.top + nodeRect.height / 2 - scrollRect.top) - scrollRect.height / 2;
        scroll.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' });
      };
      if (Math.abs(targetZoom - zoom) > 0.01) requestAnimationFrame(center);
      else center();
    },
    [zoom],
  );

  // Keep the scrollable stage size in sync with content so large/zoomed trees stay scrollable.
  // NOTE: the stage sizes to its OWN content only — it must not depend on the wrapper,
  // otherwise stageSize → wrapper → stage → stageSize becomes a feedback loop that makes
  // the canvas vibrate whenever zoom ≠ 1.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let last = { w: -1, h: -1 };
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (Math.abs(w - last.w) > 0.5 || Math.abs(h - last.h) > 0.5) {
        last = { w, h };
        setStageSize({ w, h });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Queries ── */
  const { data: raw = [], isLoading, isError, refetch } = useQuery<OrgUser[]>({
    queryKey: ['organization-tree', isAuthenticated],
    queryFn: async () => {
      const res: any = await userApi.getAll({ simple: 1, is_active: true });
      const list: any[] = res?.data ?? (Array.isArray(res) ? res : []);

      const mapped = list.map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email ?? '',
        role: u.role ?? 'employee',
        role_id: u.role_id ?? null,
        role_name: u.role_name ?? '',
        role_color: u.role_color ?? 'slate',
        hierarchy_level: u.hierarchy_level ?? 100,
        reporting_manager_id: u.reporting_manager_id ?? null,
        department: (u.department ?? '').trim(),
        department_id: typeof u.department_id === 'number' ? u.department_id : null,
        team: u.team && typeof u.team.id === 'number'
          ? { id: u.team.id, name: u.team.name, is_manager: !!u.team.is_manager }
          : null,
        created_at: u.created_at ?? undefined,
        groups: Array.isArray(u.groups) ? u.groups.map((g: any) => ({ id: g.id, name: g.name, slug: g.slug })) : [],
      })) as OrgUser[];

      return mapped;
    },
    enabled: isAuthenticated && !isAuthLoading,
    staleTime: 0, // Always fetch fresh data
    gcTime: 5 * 60 * 1000, // Cache for 5 minutes only (gcTime = garbage collection time)
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchOnMount: 'always', // Always refetch on mount
  });

  /* ── Reporting breadcrumb lookups ── */
  const byId = useMemo(() => new Map<number, OrgUser>(raw.map((u) => [u.id, u])), [raw]);

  // Walk upward via reporting_manager_id to build the approval line.
  const reportingChain = (startId: number | null): OrgUser[] | null => {
    if (startId == null) return null;
    const chain: OrgUser[] = [];
    const seen = new Set<number>();
    let cur: OrgUser | undefined = byId.get(startId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      const mgrId = cur.reporting_manager_id;
      cur = mgrId != null ? byId.get(mgrId) : undefined;
    }
    return chain.length ? chain : null;
  };
  const activeChain = reportingChain(pinned ?? hovered);

  // Force refetch on initial load to ensure fresh data
  useEffect(() => {
    if (isAuthenticated && !isAuthLoading) {
      refetch();
    }
  }, [isAuthenticated, isAuthLoading, refetch]);

  const { data: rolesData = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const res = await roleApi.list();
      return res.data.data;
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  /* ── Separate unassigned (non-Admin, department-less) users ── */
  const { treeUsers, unassignedUsers } = useMemo(() => {
    const inTree: OrgUser[] = [];
    const unassigned: OrgUser[] = [];
    for (const u of raw) {
      // Admins always belong in the tree (even with no department).
      // Non-admins with no department are shown in the "No Department Assigned" box.
      if (u.department_id === null && u.role !== 'admin') {
        unassigned.push(u);
      } else {
        inTree.push(u);
      }
    }
    return { treeUsers: inTree, unassignedUsers: unassigned };
  }, [raw]);

  /* ── Build tree (Admin is always the single root) ── */
  const tree = useMemo(() => {
    // Deduplicate users by ID
    const uniqueUsers = new Map<number, OrgUser>();
    for (const u of treeUsers) {
      if (!uniqueUsers.has(u.id)) {
        uniqueUsers.set(u.id, u);
      }
    }
    const dedupedUsers = Array.from(uniqueUsers.values());

    // Step 1: Find admin by role — NEVER by hierarchy_level. If multiple admins
    // exist, the earliest created_at is the single root; the rest become its
    // direct children (rendered as Admin peers, not Managers).
    const admins = dedupedUsers.filter((u) => u.role === 'admin');
    const admin = admins.length
      ? [...admins].sort((a, b) => {
          const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
          const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
          return ca - cb;
        })[0]
      : null;

    if (!admin) {
      return {
        admin: null as OrgUser | null,
        childrenMap: new Map<number, OrgUser[]>(),
        allIds: [] as number[],
        managers: [] as OrgUser[],
      };
    }

    const childrenMap = new Map<number, OrgUser[]>();
    const userById = new Map<number, OrgUser>(dedupedUsers.map((u) => [u.id, u]));
    const placedUserIds = new Set<number>();

    // Place admin at root
    placedUserIds.add(admin.id);

    // Step 2: Identify managers and custom roles (hierarchy < 100 but not admin)
    // These can have employees under them
    const managers = dedupedUsers.filter((u) =>
      u.id !== admin.id &&
      u.hierarchy_level < 100 &&
      u.department_id !== null,
    ).sort((a, b) => a.hierarchy_level - b.hierarchy_level);

    // Step 3: Place users by explicit reporting_manager_id FIRST (highest priority)
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;

      if (u.reporting_manager_id && userById.has(u.reporting_manager_id)) {
        const manager = userById.get(u.reporting_manager_id)!;

        // The assigned manager wins. Full stop.
        //
        // There used to be a "closer superior" override here: if anyone in the
        // same DEPARTMENT sat between this person and their assigned manager,
        // the assignment was skipped and Step 4 re-parented them by department
        // instead. That is why the chart could contradict the pinned reporting
        // line directly above it — the line walked reporting_manager_id
        // faithfully while the tree quietly substituted someone else.
        //
        // Every HRMS draws the chart from this one field (BambooHR's "Reports
        // To", Zoho's reporting hierarchy). Department decides grouping and
        // colour; it never decides parentage. The only constraint is authority:
        // a manager must outrank the person reporting to them, which permits
        // manager -> manager and manager -> admin.
        if (manager.hierarchy_level < u.hierarchy_level) {
          if (!childrenMap.has(manager.id)) childrenMap.set(manager.id, []);
          childrenMap.get(manager.id)!.push(u);
          placedUserIds.add(u.id);
        }
      }
    }

    // Step 3.5: Auto-place managers/custom roles under the highest-ranked
    // person (lowest level number) in their same department.
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;
      if (u.hierarchy_level >= 100) continue; // employees handled in Step 4

      const userDept = u.department_id;

      const sameDeptSuperiors = dedupedUsers.filter(
        (other) =>
          other.id !== u.id &&
          other.department_id === userDept &&
          other.hierarchy_level < u.hierarchy_level,
      );

      if (sameDeptSuperiors.length > 0) {
        const superior = sameDeptSuperiors.sort(
          (a, b) => a.hierarchy_level - b.hierarchy_level,
        )[0];
        if (!childrenMap.has(superior.id)) childrenMap.set(superior.id, []);
        childrenMap.get(superior.id)!.push(u);
        placedUserIds.add(u.id);
      } else {
        if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
        childrenMap.get(admin.id)!.push(u);
        placedUserIds.add(u.id);
      }
    }

    // Step 4: Place employees under their CLOSEST superior in the same department
    for (const u of dedupedUsers) {
      if (u.id === admin.id) continue;
      if (placedUserIds.has(u.id)) continue;

      if (u.hierarchy_level >= 100) {
        const userDept = u.department_id;

        // All same-department people ranked higher (lower level number)
        const deptSuperiors = dedupedUsers.filter(
          (other) =>
            other.id !== u.id &&
            other.department_id === userDept &&
            other.hierarchy_level < u.hierarchy_level,
        );

        if (deptSuperiors.length > 0) {
          // Closest superior = highest level number that is still lower than the employee's
          const closestSuperior = deptSuperiors.sort(
            (a, b) => b.hierarchy_level - a.hierarchy_level,
          )[0];
          if (!childrenMap.has(closestSuperior.id)) childrenMap.set(closestSuperior.id, []);
          childrenMap.get(closestSuperior.id)!.push(u);
          placedUserIds.add(u.id);
        } else {
          // No superior in same dept, attach directly to admin
          if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
          childrenMap.get(admin.id)!.push(u);
          placedUserIds.add(u.id);
        }
      } else {
        // Any remaining non-employees (safety net) go under admin
        if (!childrenMap.has(admin.id)) childrenMap.set(admin.id, []);
        childrenMap.get(admin.id)!.push(u);
        placedUserIds.add(u.id);
      }
    }

    return {
      admin,
      childrenMap,
      allIds: Array.from(uniqueUsers.keys()),
      managers,
    };
  }, [treeUsers]); // Removed currentUser - prevents refresh race condition

  /* ── By Dept tree: Department & Team as explicit intermediate nodes ──
     Re-roots the same people under Admin → Department → Team → Members.
     Uses the identical childrenMap shape + data-node-id connectors as the
     reporting tree; only the grouping/nesting order differs. */
  const { deptChildrenMap, deptNodeById } = useMemo(() => {
    const childrenMap = new Map<NodeId, OrgNode[]>();
    const nodeById = new Map<NodeId, OrgNode>();
    for (const u of raw) nodeById.set(u.id, { kind: 'user', id: u.id, user: u });

    const adminId = tree.admin?.id ?? -1;
    const pushChild = (parentId: NodeId, child: OrgNode) => {
      const arr = childrenMap.get(parentId) ?? [];
      arr.push(child);
      childrenMap.set(parentId, arr);
    };

    // Bucket users by department (skip department-less; handled elsewhere).
    const byDept = new Map<number, OrgUser[]>();
    for (const u of raw) {
      if (u.department_id == null) continue;
      const arr = byDept.get(u.department_id) ?? [];
      arr.push(u);
      byDept.set(u.department_id, arr);
    }

    const deptEntries = Array.from(byDept.entries()).sort((a, b) =>
      deptLabel(a[1][0].department).localeCompare(deptLabel(b[1][0].department)),
    );

    const adminChildren: OrgNode[] = [];

    for (const [deptId, users] of deptEntries) {
      const deptName = deptLabel(users[0].department);
      const deptNode: OrgNode = { kind: 'dept', id: `dept:${deptId}`, name: deptName, headcount: users.length };
      nodeById.set(deptNode.id, deptNode);

      const deptChildren: OrgNode[] = [];

      // Group members into teams.
      const teamMap = new Map<number, OrgUser[]>();
      const direct: OrgUser[] = [];
      for (const u of users) {
        if (u.team && u.team.id != null) {
          const arr = teamMap.get(u.team.id) ?? [];
          arr.push(u);
          teamMap.set(u.team.id, arr);
        } else {
          direct.push(u);
        }
      }

      const teamsEntries = Array.from(teamMap.entries()).sort((a, b) =>
        a[1][0].team!.name.localeCompare(b[1][0].team!.name),
      );

      for (const [teamId, teamUsers] of teamsEntries) {
        const teamName = teamUsers[0].team!.name;
        const teamNode: OrgNode = { kind: 'team', id: `team:${teamId}`, name: teamName, headcount: teamUsers.length, deptId };
        nodeById.set(teamNode.id, teamNode);

        const managers = teamUsers.filter((u) => u.team?.is_manager);
        const members = teamUsers.filter((u) => !u.team?.is_manager);
        const placed = new Set<number>();

        // One or more managers sit directly under the team node...
        for (const m of managers) {
          pushChild(teamNode.id, { kind: 'user', id: m.id, user: m });
          childrenMap.set(m.id, childrenMap.get(m.id) ?? []);
        }
        // ...and members hang under their (same-team) manager, else under the team.
        for (const mem of members) {
          const mgr = mem.reporting_manager_id != null ? managers.find((m) => m.id === mem.reporting_manager_id) : undefined;
          const target = mgr ?? managers[0];
          if (target) {
            pushChild(target.id, { kind: 'user', id: mem.id, user: mem });
            placed.add(mem.id);
          }
        }
        for (const mem of members) {
          if (!placed.has(mem.id)) pushChild(teamNode.id, { kind: 'user', id: mem.id, user: mem });
        }

        deptChildren.push(teamNode);
      }

      // Department-less-within-dept: users with no team.
      for (const d of direct) deptChildren.push({ kind: 'user', id: d.id, user: d });

      childrenMap.set(deptNode.id, deptChildren);
      adminChildren.push(deptNode);
    }

    childrenMap.set(adminId, adminChildren);
    return { deptChildrenMap: childrenMap, deptNodeById: nodeById };
  }, [raw, tree.admin]);

  /* ── Auto-collapse defaults ──
     By Dept has more structural levels (Admin → Department → Team → Manager →
     Members) than the reporting tree, so it uses a stricter default: every
     department except the first is collapsed on entry, plus any oversized
     branch. Simple/Detailed keep the per-branch (>10 children) threshold. */
  const computeDefaultCollapsed = useCallback(
    (mode: 'simple' | 'detailed' | 'departments'): Set<NodeId> => {
      const auto = new Set<NodeId>();
      if (mode === 'departments') {
        const adminId = tree.admin?.id ?? -1;
        const depts = deptChildrenMap.get(adminId) ?? [];
        depts.forEach((d, i) => {
          if (i > 0) auto.add(d.id); // keep only the first department open
        });
        for (const [parentId, children] of deptChildrenMap) {
          if (children.length > 10) auto.add(parentId);
        }
      } else {
        for (const [parentId, children] of tree.childrenMap) {
          if (children.length > 10) auto.add(parentId);
        }
      }
      return auto;
    },
    [deptChildrenMap, tree.childrenMap, tree.admin],
  );

  // Apply the default collapse once, when tree data first becomes available.
  // View switches apply their own default synchronously in the toolbar handler,
  // so this must NOT re-run on every collapsed change (that would break
  // "Expand All"). A ref gates it to a single application per initial load.
  const autoCollapseInitialized = useRef(false);
  useEffect(() => {
    if (autoCollapseInitialized.current) return;
    const hasData = view === 'departments' ? deptChildrenMap.size > 0 : tree.childrenMap.size > 0;
    if (!hasData) return;
    autoCollapseInitialized.current = true;
    const auto = computeDefaultCollapsed(view);
    if (auto.size > 0) setCollapsed(auto);
  }, [view, deptChildrenMap, tree.childrenMap, computeDefaultCollapsed]);

  /* ── View-dependent tree maps (shared connector mechanism) ── */
  const reportNodeById = useMemo(
    () => new Map<NodeId, OrgNode>(raw.map((u) => [u.id, { kind: 'user', id: u.id, user: u }])),
    [raw],
  );
  const activeChildrenMap = view === 'departments' ? deptChildrenMap : tree.childrenMap;
  const activeNodeById = view === 'departments' ? deptNodeById : reportNodeById;

  /* ── Draw connectors (live INSIDE the scaled stage, so they zoom WITH the
      nodes and never need redrawing on zoom — kills the per-step flicker) ── */
  useEffect(() => {
    const draw = () => {
      const el = stageRef.current;
      if (!el) return;

      const sr = el.getBoundingClientRect();
      const z = zoomRef.current;
      const segs: ConnectorSeg[] = [];

      // One indexed DOM pass per draw call — attribute selectors aren't indexed,
      // so querying [data-node-id="X"] per node is an O(DOM) scan each time.
      // Build a Map once and look up from it instead.
      const nodeEls = new Map<string, HTMLElement>();
      el.querySelectorAll<HTMLElement>('[data-node-id]').forEach((node) => {
        const id = node.getAttribute('data-node-id');
        if (id) nodeEls.set(id, node);
      });

      const getNodePos = (id: NodeId) => {
        const node = nodeEls.get(String(id));
        if (!node) return null;
        const r = node.getBoundingClientRect();
        const ux = (r.left - sr.left) / z;
        const uy = (r.top - sr.top) / z;
        return {
          cx: ux + r.width / (2 * z),
          left: ux,
          top: uy,
          bottom: uy + r.height / z,
          cy: uy + r.height / (2 * z),
        };
      };

      for (const [parentId, children] of activeChildrenMap) {
        const parentPos = getNodePos(parentId);
        if (!parentPos) continue;

        const parentNode = activeNodeById.get(parentId);
        const parentTeamId = parentNode && parentNode.kind === 'user' ? parentNode.user.team?.id ?? null : null;

        // Must match the renderer's decision exactly, or lines miss their cards.
        const stacked = shouldStackChildren(children, activeChildrenMap);

        for (const child of children) {
          const childPos = getNodePos(child.id);
          if (!childPos) continue;

          const childNode = activeNodeById.get(child.id);
          // Department/Team nodes are GROUPING edges (dashed) — not strict
          // reporting lines. Within-team edges (parent is a team node) stay solid.
          const isGrouping =
            !!childNode &&
            (childNode.kind === 'dept' ||
              (childNode.kind === 'team' && parentNode?.kind !== 'team'));
          const isTeamEdge =
            view !== 'simple' &&
            childNode?.kind === 'user' &&
            !!childNode.user.team &&
            childNode.user.team.id !== parentTeamId &&
            parentNode?.kind !== 'team';

          segs.push({
            path: stacked
              ? stackPath(parentPos.cx, parentPos.bottom, childPos.left, childPos.cy)
              : elbowPath(parentPos.cx, parentPos.bottom, childPos.cx, childPos.top),
            team: isTeamEdge || isGrouping,
            id: child.id,
          });
        }
      }

      // Bail out when nothing actually moved.
      //
      // This is what stops the jitter. draw() writes connector paths INTO the
      // element the ResizeObserver below is watching, so every draw resizes the
      // observed subtree and re-triggers the observer. Because setConnectors
      // was handed a brand-new array each time, React re-rendered on every
      // cycle even when the paths were byte-identical, and the observer never
      // reached a steady state — it just kept firing, repainting the tree
      // continuously. Moving the mouse piled more renders on top, which is why
      // it showed up as hover jitter.
      //
      // Comparing first makes the loop self-terminating: identical geometry
      // produces no state update, so the observer goes quiet.
      const signature = segs.map((s) => `${s.id}|${s.team ? 1 : 0}|${s.path}`).join('~');
      if (signature === connectorSignatureRef.current) return;
      connectorSignatureRef.current = signature;

      setConnectors(segs);
    };

    // rAF-coalesced: a burst of resize notifications collapses into one draw
    // per frame instead of one synchronous draw per notification.
    let frame = 0;
    const scheduleDraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(scheduleDraw);
    const wrapper = wrapperRef.current;
    if (wrapper) ro.observe(wrapper);
    scheduleDraw();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [activeChildrenMap, activeNodeById, collapsed, search, raw, view]);

  /* ── Toggle collapse ── */
  const toggle = (id: NodeId) => {
    setCollapsed((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  /* ── Role cards ── */
  const roleCards = useMemo(() => {
    const activeRoles = rolesData.filter((r: any) => r.is_active);
    return activeRoles.map((role: any) => {
      const count = role.is_system
        ? raw.filter((u) => u.role_id === role.id || (!u.role_id && u.role === role.slug)).length
        : raw.filter((u) => u.role_id === role.id).length;
      const Icon =
        role.slug === 'admin' ? Crown :
        role.slug === 'employee' ? Users :
        role.slug === 'manager' ? Network :
        Shield;
      const colorTone = getRoleColor(role.color, role.hierarchy_level);
      return {
        key: `role-card-${role.id}`,
        label: role.name,
        value: count,
        hint: role.is_system ? `System role • Level ${role.hierarchy_level}` : `Custom role • Level ${role.hierarchy_level}`,
        icon: Icon,
        accent: colorTone.badge,
        dot: colorTone.avatar.split(' ')[0],
      };
    });
  }, [rolesData, raw]);

  /* ── Filtered state ── */
  const q = search.trim().toLowerCase();

  /* ── Loading / error states ── */
  if (isAuthLoading || isLoading) return <PageLoadingState label="Building organization tree…" />;
  if (!isAuthenticated) return <PageErrorState message="Please log in to view this page." />;
  if (isError) return <PageErrorState message="Unable to load organization data right now." />;
  
  // No admin record available → empty state (covers zero admins and zero data)
  if (!tree.admin) {
    return <PageEmptyState title="No organization data" description="No admin record is available." />;
  }

  return (
    <div className="min-h-screen bg-slate-50/60 pb-8">
      <PageHeader title="Organization" description="Company hierarchy — admins, departments, managers, and reporting structure." />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* ── Stats ── */}
        <div className={`mb-5 grid grid-cols-2 gap-3 ${roleCards.length > 4 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
          {roleCards.map((s) => (
            <SurfaceCard key={s.key} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{s.value}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">{s.hint}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <s.icon className={`h-5 w-5 ${s.accent}`} />
                  <div className={`h-3 w-3 rounded-full ${s.dot}`} />
                </div>
              </div>
            </SurfaceCard>
          ))}
          {unassignedUsers.length > 0 && (
            <SurfaceCard className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">No Department</p>
                  <p className="mt-1 text-2xl font-semibold text-amber-600">{unassignedUsers.length}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">Unassigned employees</p>
                </div>
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
            </SurfaceCard>
          )}
        </div>

        {/* ── Toolbar ── */}
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, department, group…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex items-center rounded-md border border-slate-200 bg-white p-0.5">
              {(['simple', 'detailed', 'departments'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setView(mode);
                    // Apply this view's default collapse in the same render so a
                    // large By Dept tree never renders fully expanded, even for
                    // one frame (which is what froze the tab).
                    setCollapsed(computeDefaultCollapsed(mode));
                  }}
                  className={`rounded px-3 py-1.5 text-xs font-semibold capitalize transition ${
                    view === mode ? 'bg-sky-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                  title={
                    mode === 'simple'
                      ? 'Flat reporting tree (no team boxes)'
                      : mode === 'detailed'
                        ? 'Team boxes + dashed team connectors'
                        : 'Group by department, then team-wise sections'
                  }
                >
                  {mode === 'departments' ? 'By Dept' : mode}
                </button>
              ))}
            </div>
            <div className="flex items-center rounded-md border border-slate-200 bg-white">
              <button
                onClick={() => setZoom((z) => clampZoom(z - 0.1))}
                className="px-2.5 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                title="Zoom out"
              >
                &#8722;
              </button>
              <button
                onClick={() => setZoom(1)}
                className="border-x border-slate-200 px-2 py-2 text-[11px] font-semibold tabular-nums text-slate-600 transition hover:bg-slate-50"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={() => setZoom((z) => clampZoom(z + 0.1))}
                className="px-2.5 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                title="Zoom in"
              >
                +
              </button>
            </div>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
              title="Refresh organization data"
            >
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
            {view !== 'departments' && (
              <>
                <button
                  onClick={() => setCollapsed(new Set(Array.from(tree.childrenMap.keys())))}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Collapse All
                </button>
                <button
                  onClick={() => setCollapsed(new Set())}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Expand All
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Legend ── */}
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Legend</span>
          {roleCards.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
              <span className={`h-3 w-3 rounded-full ${s.dot}`} />
              {s.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
            <span className="inline-block h-3 w-3 rounded-[3px] border-2 border-dashed border-indigo-300 bg-indigo-50" />
            Team group
          </span>
          <span className="ml-auto text-[10px] text-slate-400">
            Scroll + Ctrl/Cmd to zoom · drag to pan
          </span>
        </div>

        {/* ── Reporting breadcrumb ──
            THIS IS THE JITTER.

            The bar is driven by `hovered`, sits in normal flow directly above
            the tree viewport, and used to be unmounted entirely when nothing
            was hovered. So: hover a card -> the bar mounts -> everything below
            it shifts down -> the card slides out from under the cursor ->
            mouseleave -> the bar unmounts -> everything shifts back up -> the
            card returns under the cursor -> mouseenter. That loop runs as fast
            as the browser can lay out, which is the shaking.

            The container is now always mounted with a reserved min-height, so
            the tree below never moves. Only the bar's own contents change. */}
        <div className="mb-5 min-h-[68px]">
        {activeChain && activeChain.length > 0 ? (
          /* flex-nowrap + horizontal scroll: a long reporting chain must not
             wrap onto a second line, because that grows the bar and shifts the
             tree below — the same loop in a slower form. Height stays constant
             regardless of chain length. */
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {pinned != null ? 'Pinned line' : 'Hover line'}
            </span>
            <div className="flex flex-nowrap items-center gap-1.5 text-sm">
              {activeChain.map((u, i) => (
                <Fragment key={u.id}>
                  {i > 0 ? (
                    <span className="text-[11px] font-medium text-slate-400">→ reports to →</span>
                  ) : null}
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                    <span className="font-semibold text-slate-800">{u.name}</span>
                    <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600">
                      {u.role_name || u.role}
                    </span>
                    {i === activeChain.length - 1 ? (
                      <span className="text-[10px] font-medium text-slate-400">Top</span>
                    ) : null}
                  </span>
                </Fragment>
              ))}
            </div>
            {pinned != null ? (
              <button
                type="button"
                onClick={() => setPinned(null)}
                className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Unpin reporting line"
              >
                Unpin ×
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">
            Hover a person to trace their reporting line · click to pin it
          </div>
        )}
        </div>

        {/* ── Tree viewport ── */}
        <div
          ref={scrollRef}
          className="relative cursor-grab overflow-auto rounded-xl border border-slate-200 bg-white active:cursor-grabbing"
          style={{ minHeight: '400px', maxHeight: '80vh' }}
          onMouseDown={onViewportMouseDown}
          onMouseMove={onViewportMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
        >
            <div
              ref={wrapperRef}
              className="relative mx-auto"
              style={{
              width: stageSize.w * zoom || 'max-content',
              height: stageSize.h * zoom || 'max-content',
              transformOrigin: '0 0',
            }}
          >
            {/* Scaled stage */}
            <div
              ref={stageRef}
              className="relative inline-block p-10"
              style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
            >
              {/* SVG connectors live INSIDE the scaled stage, so the ancestor's
                  transform: scale(zoom) rescales them together with the nodes for
                  free — no redraw is needed on zoom. width/height 100% now resolve
                  against the stage's own UNSCALED box (percentages are computed
                  before the transform), which is exactly the coordinate space
                  getNodePos() produces. */}
              <svg
                className="pointer-events-none absolute inset-0 z-0"
                width="100%"
                height="100%"
              >
                {connectors.map((c, i) =>
                  c.path ? (
                    <g key={`c${i}`}>
                      {/* Wide invisible hit area so the thin connector line is easy to click.
                          Overrides the parent's pointer-events:none with stroke-only hit testing. */}
                      <path
                        d={c.path}
                        stroke="transparent"
                        strokeWidth={14}
                        fill="none"
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => focusNode(c.id)}
                      />
                      {/* Lighter than before: at 2px slate-400 the lines competed
                          with the cards. Structure should be legible but recede. */}
                      <path
                        d={c.path}
                        stroke={c.team ? '#c7d2fe' : '#cbd5e1'}
                        strokeWidth={1.5}
                        strokeDasharray={c.team ? '5 4' : undefined}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  ) : null,
                )}
              </svg>

              {view === 'departments' ? (
                /* By Dept tree: Admin → Department → Team → Members (real nested tree) */
                <div className="relative z-10 flex flex-col items-center gap-8">
                  {/* Admin root */}
                  <div className="flex justify-center">
                    <div>
                      <TreeNodeCard
                        user={tree.admin}
                        matched={q ? matchUser(tree.admin, q) : undefined}
                        onMouseEnter={() => handleHoverUser(tree.admin.id)}
                        onMouseLeave={() => handleHoverUser(-1)}
                        onClick={() => handlePinUser(tree.admin.id)}
                      />
                    </div>
                  </div>

                  <DeptSubTree
                    parentId={tree.admin.id}
                    childrenMap={deptChildrenMap}
                    collapsed={collapsed}
                    onToggle={toggle}
                    q={q}
                    onHoverUser={handleHoverUser}
                    onPinUser={handlePinUser}
                  />
                </div>
              ) : (
                /* Tree content */
                <div className="relative z-10 flex flex-col items-center gap-8">
                  {/* Admin */}
                  <div className="flex justify-center">
                    <div>
                      <TreeNodeCard
                        user={tree.admin}
                        simple={simple}
                        matched={q ? matchUser(tree.admin, q) : undefined}
                        onMouseEnter={() => handleHoverUser(tree.admin.id)}
                        onMouseLeave={() => handleHoverUser(-1)}
                        onClick={() => handlePinUser(tree.admin.id)}
                      />
                    </div>
                  </div>

                  {/* Recursive subordinate tree */}
                  <SubordinateTree
                    parentId={tree.admin.id}
                    depth={1}
                    childrenMap={tree.childrenMap}
                    collapsed={collapsed}
                    onToggle={toggle}
                    q={q}
                    simple={simple}
                    onHoverUser={handleHoverUser}
                    onPinUser={handlePinUser}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Unassigned Department Employees ── */}
        {unassignedUsers.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-slate-700">
                No Department Assigned
              </h2>
              <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                {unassignedUsers.length}
              </span>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex flex-wrap gap-3">
                {unassignedUsers
                  .filter((u) => (q ? matchUser(u, q) : true))
                  .map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-white px-3 py-2 shadow-sm"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700">
                        {initials(u.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{u.name}</p>
                        <p className="text-[10px] text-slate-400">{u.role_name || u.role}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Routing note ── */}
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
          <p className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <Network className="h-3.5 w-3.5 text-slate-400" />
            How Routing Works
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Approval requests route to the employee&apos;s explicit{' '}
            <strong>reporting manager</strong> first. If none is set, the system falls back
            to the <strong>nearest higher-ranked colleague in the same department</strong>.
            New departments and employees appear here automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
