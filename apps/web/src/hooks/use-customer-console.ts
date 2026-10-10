'use client';

/**
 * Customer management console data hooks. No polling anywhere (mobile-perf standard): the roster
 * and detail are read on mount / filter change and after each mutation, never on a timer.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import {
  listQueryString,
  type CustomerDetail,
  type CustomerInvoiceView,
  type CustomerListResponse,
  type ListFilters,
} from '@/lib/customer-console';

export const customerKeys = {
  all: ['super', 'customers'] as const,
  list: (f: ListFilters) => ['super', 'customers', 'list', listQueryString(f)] as const,
  detail: (id: string) => ['super', 'customers', 'detail', id] as const,
};

export function useCustomerList(filters: ListFilters, enabled = true) {
  return useQuery<CustomerListResponse>({
    queryKey: customerKeys.list(filters),
    queryFn: () => apiFetch<CustomerListResponse>(`/super/customers${listQueryString(filters)}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export function useCustomerDetail(id: string | undefined, enabled = true) {
  return useQuery<CustomerDetail>({
    queryKey: customerKeys.detail(id ?? ''),
    queryFn: () => apiFetch<CustomerDetail>(`/super/customers/${id}`),
    enabled: !!id && enabled,
  });
}

function useCustomerMutation<TBody, TResult = unknown>(id: string, run: (body: TBody) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: customerKeys.detail(id) });
      qc.invalidateQueries({ queryKey: ['super', 'customers', 'list'] });
    },
  });
}

export function useUpdateCustomerLicense(id: string) {
  return useCustomerMutation(id, (body: Record<string, unknown>) =>
    apiFetch(`/super/customers/${id}/license`, { method: 'PATCH', body: JSON.stringify(body) }),
  );
}

export function useSuspendCustomer(id: string) {
  return useCustomerMutation(id, (body: { suspend: boolean; reason?: string }) =>
    apiFetch(`/super/customers/${id}/${body.suspend ? 'suspend' : 'reactivate'}`, {
      method: 'POST',
      body: JSON.stringify(body.suspend ? { reason: body.reason ?? '' } : {}),
    }),
  );
}

export function useCreateInvoice(id: string) {
  return useCustomerMutation(id, (body: Record<string, unknown>) =>
    apiFetch<CustomerInvoiceView>(`/super/customers/${id}/invoices`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useUpdateInvoice(id: string) {
  return useCustomerMutation(id, ({ invoiceId, ...body }: { invoiceId: string } & Record<string, unknown>) =>
    apiFetch<CustomerInvoiceView>(`/super/customers/${id}/invoices/${invoiceId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  );
}

export function useIssueStarterLink(id: string) {
  return useCustomerMutation(id, () =>
    apiFetch<{ url: string; expiresAt: string }>(`/super/customers/${id}/starter-link`, { method: 'POST', body: '{}' }),
  );
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<{ id: string; slug: string; starterLink: { url: string; expiresAt: string } }>('/super/customers', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: customerKeys.all }),
  });
}
