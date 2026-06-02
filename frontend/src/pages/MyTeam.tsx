import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ChevronDown, ChevronRight, Network, Search, Users, X } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageErrorState, PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { teamApi } from '@/services/api';
import TeamPersonCard, { iconForTone, initials, toneForLevel } from '@/features/team/TeamPersonCard';
import type { TeamHierarchyMember, TeamHierarchyPayload, TeamPerson } from '@/types';

function HierarchyNode({
  member,
  childrenMap,
  collapsed,
  onToggle,
  q,
  currentUserId,
}: {
  member: TeamHierarchyMember;
  childrenMap: Map<number, TeamHierarchyMember[]>;
  collapsed: Set<number>;
  onToggle: (id: number) => void;
  q: string;
  currentUserId: number;
}) {
  const children = childrenMap.get(member.id) ?? [];
  const isSelf = member.id === currentUserId;
  const tone = toneForLevel(member.hierarchy_level);
  const Icon = iconForTone(tone);
  const matched = q ? memberMatches(member, q) : true;
  const hasMatchInSubtree = q ? (() => {
    const check = (m: TeamHierarchyMember): boolean => {
      if (memberMatches(m, q)) return true;
      const kids = childrenMap.get(m.id) ?? [];
      return kids.some(check);
    };
    return check(member);
  })() : true;

  if (!hasMatchInSubtree) return null;

  const showChildren = !q && !collapsed.has(member.id) && children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <div
        data-node-id={member.id}
        className={`relative flex w-[210px] flex-col items-center gap-2 rounded-xl border-2 bg-white p-3 shadow-sm transition-all hover:shadow-md ${
          isSelf ? 'border-sky-400 ring-2 ring-sky-300' : 'border-slate-200'
        } ${!matched ? 'opacity-40' : ''}`}
      >
        <div className="flex w-full items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
            {initials(member.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-bold leading-tight text-slate-900">
              {member.name}
              {isSelf ? <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-sky-700">(You)</span> : null}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-slate-600">
              <Icon className="h-3 w-3" /> {member.role_name || '—'}
            </p>
            {member.department ? <p className="mt-0.5 truncate text-[11px] text-slate-500">{member.department}</p> : null}
            {member.designation ? <p className="mt-0.5 truncate text-[10px] text-slate-400">{member.designation}</p> : null}
          </div>
        </div>
        {children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(member.id)}
            className="flex items-center gap-1 self-end rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            {collapsed.has(member.id) || q ? (
              <>
                <ChevronRight className="h-3 w-3" /> {children.length} report{children.length === 1 ? '' : 's'}
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Collapse
              </>
            )}
          </button>
        ) : null}
      </div>

      {showChildren ? (
        <div className="mt-3 flex flex-wrap items-start justify-center gap-6">
          {children.map((child) => (
            <div key={child.id} className="flex flex-col items-center">
              <ArrowDown className="mb-1 h-4 w-4 text-slate-300" />
              <HierarchyNode
                member={child}
                childrenMap={childrenMap}
                collapsed={collapsed}
                onToggle={onToggle}
                q={q}
                currentUserId={currentUserId}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const memberMatches = (m: TeamHierarchyMember, q: string) => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    m.name.toLowerCase().includes(needle) ||
    (m.email?.toLowerCase().includes(needle) ?? false) ||
    (m.department?.toLowerCase().includes(needle) ?? false) ||
    (m.role_name?.toLowerCase().includes(needle) ?? false) ||
    (m.designation?.toLowerCase().includes(needle) ?? false)
  );
};

const buildTree = (
  members: TeamHierarchyMember[],
): { roots: TeamHierarchyMember[]; childrenMap: Map<number, TeamHierarchyMember[]> } => {
  const childrenMap = new Map<number, TeamHierarchyMember[]>();
  const byId = new Map<number, TeamHierarchyMember>();
  members.forEach((m) => byId.set(m.id, m));

  for (const m of members) {
    const parentId = m.reporting_manager_id;
    if (parentId && byId.has(parentId)) {
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(m);
    }
  }

  // Sort children by hierarchy level (managers first), then by name
  for (const list of childrenMap.values()) {
    list.sort((a, b) => (a.hierarchy_level - b.hierarchy_level) || a.name.localeCompare(b.name));
  }

  // Roots = members without a valid parent in the visible set
  const roots = members
    .filter((m) => !m.reporting_manager_id || !byId.has(m.reporting_manager_id))
    .sort((a, b) => (a.hierarchy_level - b.hierarchy_level) || a.name.localeCompare(b.name));

  return { roots, childrenMap };
};

export default function MyTeam() {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const treeWrapperRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<TeamHierarchyPayload>({
    queryKey: ['team-hierarchy'],
    queryFn: async () => {
      const res: any = await teamApi.getHierarchy();
      return (res?.data ?? res) as TeamHierarchyPayload;
    },
  });

  const q = search.trim().toLowerCase();

  const tree = useMemo(() => {
    if (!data) return { roots: [], childrenMap: new Map<number, TeamHierarchyMember[]>() };
    return buildTree(data.members);
  }, [data]);

  useEffect(() => {
    if (tree.childrenMap.size > 0 && collapsed.size === 0 && !q) {
      const auto = new Set<number>();
      for (const [parentId, children] of tree.childrenMap) {
        if (children.length > 6) auto.add(parentId);
      }
      if (auto.size > 0) setCollapsed(auto);
    }
  }, [tree.childrenMap, collapsed.size, q]);

  const toggle = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return <PageLoadingState label="Loading your team…" />;
  }
  if (isError) {
    return <PageErrorState message="Unable to load your team right now." onRetry={() => refetch()} />;
  }
  if (!data) {
    return <PageEmptyState title="No team data" description="We couldn't load your team." />;
  }

  const { current_user, manager, ancestors, direct_reports, direct_reports_count, department, managed_departments, scope, members } = data;
  const reportingChain: TeamPerson[] = [...ancestors].reverse(); // for visual top-down: user → manager → top

  return (
    <div className="min-h-screen bg-slate-50/60 pb-8">
      <PageHeader
        title="My Team & Hierarchy"
        eyebrow={`Signed in as ${current_user.name}`}
        description={
          scope.is_admin
            ? 'You can see everyone in your organization.'
            : scope.is_manager
              ? 'You can see the departments you manage and the people in them.'
              : 'You can see your department, your manager, and your teammates.'
        }
      />

      <div className="mx-auto max-w-7xl space-y-5 px-4 sm:px-6 lg:px-8">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile
            label="Your Manager"
            value={manager?.name ?? 'Unassigned'}
            sublabel={manager?.role_name ?? 'No reporting manager set'}
            icon={Network}
            accent="text-sky-600"
          />
          <SummaryTile
            label="Chain of Command"
            value={`${ancestors.length} level${ancestors.length === 1 ? '' : 's'} above you`}
            sublabel={ancestors.length > 0 ? ancestors[ancestors.length - 1].name : 'No one above you'}
            icon={Network}
            accent="text-violet-600"
          />
          <SummaryTile
            label="Direct Reports"
            value={String(direct_reports_count ?? direct_reports.length)}
            sublabel={
              direct_reports.length === 0
                ? 'You do not manage anyone'
                : `${direct_reports[0].name}${direct_reports.length > 1 ? ` and ${direct_reports.length - 1} more` : ''}`
            }
            icon={Users}
            accent="text-emerald-600"
          />
          <SummaryTile
            label="Department"
            value={department?.name ?? 'Unassigned'}
            sublabel={`${scope.total_members} member${scope.total_members === 1 ? '' : 's'} in your view`}
            icon={Network}
            accent="text-amber-600"
          />
        </div>

        {/* Management chain (you → manager → …) */}
        <SurfaceCard className="p-5">
          <SectionTitle title="Your reporting chain" subtitle="Bottom-up: you at the top of this list, all the way up to the organization owner." />
          {reportingChain.length === 0 && !manager ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
              You don&apos;t have a reporting manager set. Ask an admin to assign one.
            </p>
          ) : (
            <ol className="space-y-2">
              <li>
                <TeamPersonCard person={current_user} variant="row" highlight isSelf subtitle="You" />
              </li>
              {reportingChain.map((person) => (
                <li key={`ancestor-${person.id}`}>
                  <div className="ml-3 border-l-2 border-dashed border-slate-200 pl-4">
                    <TeamPersonCard person={person} variant="row" subtitle={person.department ?? undefined} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SurfaceCard>

        {/* Direct reports + Department chips */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SurfaceCard className="p-5">
            <SectionTitle title="People who report to you" subtitle={`${direct_reports.length} direct report${direct_reports.length === 1 ? '' : 's'}`} />
            {direct_reports.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
                No one currently reports to you. This list updates when admins change reporting managers.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {direct_reports.map((person) => (
                  <TeamPersonCard
                    key={`report-${person.id}`}
                    person={person}
                    variant="row"
                    subtitle={person.department ?? undefined}
                  />
                ))}
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <SectionTitle title="Departments in your view" subtitle={`${managed_departments.length} department${managed_departments.length === 1 ? '' : 's'}`} />
            {managed_departments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
                You aren&apos;t in a department yet. Ask an admin to assign you to one.
              </p>
            ) : (
              <ul className="space-y-2">
                {managed_departments.map((dept) => (
                  <li
                    key={`dept-${dept.id}`}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                      dept.is_primary ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {dept.name}
                        {dept.is_primary ? (
                          <span className="ml-2 rounded-md bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                            Your department
                          </span>
                        ) : null}
                      </p>
                      {dept.description ? <p className="mt-1 text-[11px] text-slate-500">{dept.description}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
        </div>

        {/* Full hierarchy tree */}
        <SurfaceCard className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <SectionTitle title="Department hierarchy" subtitle={`${members.length} member${members.length === 1 ? '' : 's'} • ${managed_departments.length} department${managed_departments.length === 1 ? '' : 's'}`} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, email, role…"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCollapsed(new Set(Array.from(tree.childrenMap.keys())))}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsed(new Set())}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Expand all
                </button>
              </div>
            </div>
          </div>

          {tree.roots.length === 0 ? (
            <PageEmptyState
              title="No hierarchy to display"
              description={
                members.length === 0
                  ? 'There are no team members in your view yet.'
                  : 'No one in your view has a reporting manager set. Ask an admin to assign managers.'
              }
            />
          ) : (
            <div
              ref={treeWrapperRef}
              className="relative overflow-auto rounded-xl border border-slate-200 bg-slate-50/40 p-6"
              style={{ minHeight: '320px' }}
            >
              <div className="flex flex-wrap items-start justify-center gap-8">
                {tree.roots.map((root) => (
                  <HierarchyNode
                    key={`root-${root.id}`}
                    member={root}
                    childrenMap={tree.childrenMap}
                    collapsed={collapsed}
                    onToggle={toggle}
                    q={q}
                    currentUserId={current_user.id}
                  />
                ))}
              </div>
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            <Network className="mr-1 inline h-3 w-3 text-slate-400" />
            Cards with a blue ring are you. Lines show direct reporting — if no manager is set, the system falls back to the nearest higher-ranked colleague in the same department. Custom roles determine card colour (admin / manager / employee).
          </p>
        </SurfaceCard>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
      {subtitle ? <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sublabel,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <SurfaceCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-2 truncate text-base font-semibold text-slate-950">{value}</p>
          <p className="mt-1 truncate text-[11px] text-slate-500">{sublabel}</p>
        </div>
        <Icon className={`h-5 w-5 shrink-0 ${accent}`} />
      </div>
    </SurfaceCard>
  );
}
