"use client";

/**
 * Customer management console data hooks. No polling anywhere (mobile-perf standard): the roster
 * and detail are read on mount / filter change and after each mutation, never on a timer.
 */
import { useSyncExternalStore } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import {
  listQueryString,
  type CustomerDetail,
  type CustomerInvoiceView,
  type CustomerListResponse,
  type ListFilters,
  type PaymentSummary,
  type InvoiceListResponse,
  type InvoiceDocument,
} from "@/lib/customer-console";

export const customerKeys = {
  all: ["super", "customers"] as const,
  list: (f: ListFilters) =>
    ["super", "customers", "list", listQueryString(f)] as const,
  detail: (id: string) => ["super", "customers", "detail", id] as const,
};

export function useCustomerList(filters: ListFilters, enabled = true) {
  return useQuery<CustomerListResponse>({
    queryKey: customerKeys.list(filters),
    queryFn: () =>
      apiFetch<CustomerListResponse>(
        `/super/customers${listQueryString(filters)}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export function useCustomerDetail(id: string | undefined, enabled = true) {
  return useQuery<CustomerDetail>({
    queryKey: customerKeys.detail(id ?? ""),
    queryFn: () => apiFetch<CustomerDetail>(`/super/customers/${id}`),
    enabled: !!id && enabled,
  });
}

function useCustomerMutation<TBody, TResult = unknown>(
  id: string,
  run: (body: TBody) => Promise<TResult>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.detail(id) });
      qc.invalidateQueries({ queryKey: ["super", "customers", "list"] });
      qc.invalidateQueries({ queryKey: ["super", "customers", "invoices"] });
      qc.invalidateQueries({ queryKey: ["super-business"] });
      qc.invalidateQueries({ queryKey: ["super", "tenants"] });
    },
  });
}

export function useUpdateCustomerLicense(id: string) {
  return useCustomerMutation(id, (body: Record<string, unknown>) =>
    apiFetch(`/super/customers/${id}/license`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

export function useSuspendCustomer(id: string) {
  return useCustomerMutation(
    id,
    (body: { suspend: boolean; reason?: string }) =>
      apiFetch(
        `/super/customers/${id}/${body.suspend ? "suspend" : "reactivate"}`,
        {
          method: "POST",
          body: JSON.stringify(
            body.suspend ? { reason: body.reason ?? "" } : {},
          ),
        },
      ),
  );
}

export function useCreateInvoice(id: string) {
  return useCustomerMutation(id, (body: Record<string, unknown>) =>
    apiFetch<CustomerInvoiceView>(`/super/customers/${id}/invoices`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export function useUpdateInvoice(id: string) {
  return useCustomerMutation(
    id,
    ({ invoiceId, ...body }: { invoiceId: string } & Record<string, unknown>) =>
      apiFetch<CustomerInvoiceView>(
        `/super/customers/${id}/invoices/${invoiceId}`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
  );
}

export function useIssueStarterLink(id: string) {
  return useCustomerMutation(id, () =>
    apiFetch<{ url: string; expiresAt: string }>(
      `/super/customers/${id}/starter-link`,
      { method: "POST", body: "{}" },
    ),
  );
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{
        id: string;
        slug: string;
        starterLink: { url: string; expiresAt: string };
      }>("/super/customers", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.all });
      qc.invalidateQueries({ queryKey: ["super-business"] });
      qc.invalidateQueries({ queryKey: ["super", "tenants"] });
    },
  });
}

export function useCustomerPaymentSummary(id: string) {
  return useQuery({
    queryKey: [...customerKeys.detail(id), "payment"],
    queryFn: () =>
      apiFetch<PaymentSummary>(`/super/customers/${id}/payment-summary`),
    staleTime: 60_000,
  });
}
export function useCustomerBranding(id: string) {
  return useCustomerMutation(id, (body: Record<string, unknown>) =>
    apiFetch(`/super/customers/${id}/branding`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}
export function useCustomerInvite(id: string) {
  return useCustomerMutation(
    id,
    (body: {
      email: string;
      firstName?: string;
      lastName?: string;
      tenantId?: string;
    }) =>
      apiFetch<{
        emailDelivered: boolean;
        acceptUrl: string;
        expiresAt: string;
      }>(`/super/customers/${id}/invites`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  );
}
export function useCreateCustomerLocation(id: string) {
  return useCustomerMutation(id, (body: { name: string; parentId?: string }) =>
    apiFetch(`/super/customers/${id}/locations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}
export function useAllocateCustomerScreens(id: string) {
  return useCustomerMutation(
    id,
    ({
      locationId,
      seatLimit,
    }: {
      locationId: string;
      seatLimit: number | null;
    }) =>
      apiFetch(`/super/customers/${id}/locations/${locationId}/allocation`, {
        method: "PATCH",
        body: JSON.stringify({ seatLimit }),
      }),
  );
}
export function useBusinessInvoices(
  filters: { q: string; status: string; page: number },
  enabled = true,
) {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.status) query.set("status", filters.status);
  query.set("page", String(filters.page));
  return useQuery({
    queryKey: ["super", "customers", "invoices", filters],
    queryFn: () =>
      apiFetch<InvoiceListResponse>(`/super/customers/invoices?${query}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}
export function useInvoiceDocument(customerId: string, invoiceId: string) {
  return useQuery({
    queryKey: [
      ...customerKeys.detail(customerId),
      "invoice-document",
      invoiceId,
    ],
    queryFn: () =>
      apiFetch<InvoiceDocument>(
        `/super/customers/${customerId}/invoices/${invoiceId}/document`,
      ),
    enabled: !!customerId && !!invoiceId,
  });
}
export function useInvoiceAttachment(customerId: string) {
  return useCustomerMutation(
    customerId,
    ({ invoiceId, file }: { invoiceId: string; file: File }) => {
      const body = new FormData();
      body.append("file", file);
      return apiFetch(
        `/super/customers/${customerId}/invoices/${invoiceId}/pdf`,
        { method: "POST", body },
      );
    },
  );
}

export function useSendOwnerInvite(id: string) {
  return useCustomerMutation(id, (body: { email: string }) =>
    apiFetch<{ url: string; expiresAt: string; emailDelivered: boolean }>(
      `/super/customers/${id}/starter-link/email`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  );
}
export function useChangeCustomerCardScreens(id: string) {
  return useCustomerMutation(
    id,
    (body: { quantity: number; confirmProration: true }) =>
      apiFetch(`/super/customers/${id}/card-seats`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
  );
}

const subscribeHydration = () => () => {};
export function useBusinessHydrated() {
  return useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
}
