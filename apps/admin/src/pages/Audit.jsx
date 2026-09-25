import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Card, PageHeading, Pagination, Skeleton, Table } from "../components/ui.jsx";

const LIMIT = 25;

/** Audit — immutable trail of every privileged action taken in the panel. */
export default function Audit() {
  const [page, setPage] = useState(1);

  const audit = useQuery({
    queryKey: ["audit", page, LIMIT],
    queryFn: () => api(`/admin/audit?page=${page}&limit=${LIMIT}`),
    keepPreviousData: true,
  });

  const items = audit.data?.items || [];

  return (
    <div>
      <PageHeading title="Audit log" subtitle={`${audit.data?.total ?? 0} privileged actions`} />

      <Card>
        {audit.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : audit.isError ? (
          <p className="py-6 text-center text-sm font-bold text-rose-600">{audit.error?.message}</p>
        ) : (
          <>
            <Table
              columns={[
                { key: "action", label: "Action", render: (r) => <span className="font-semibold">{r.action}</span> },
                { key: "actor", label: "By" },
                { key: "targetType", label: "Target", render: (r) => <span className="text-xs">{r.targetType}</span> },
                {
                  key: "targetId",
                  label: "Target id",
                  render: (r) => <span className="font-mono text-[11px]">{String(r.targetId || "").slice(-8) || "—"}</span>,
                },
                {
                  key: "details",
                  label: "Details",
                  render: (r) => (
                    <span className="block max-w-[260px] truncate text-xs text-[#7a3d58]" title={JSON.stringify(r.details)}>
                      {r.details ? JSON.stringify(r.details) : "—"}
                    </span>
                  ),
                },
                {
                  key: "createdAt",
                  label: "Time",
                  render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : "—"),
                },
              ]}
              data={items}
              empty="No audit entries"
            />
            <Pagination page={page} limit={LIMIT} total={audit.data?.total || 0} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
