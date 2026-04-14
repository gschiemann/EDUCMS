import { useQuery } from '@tanstack/react-query';

const API_URL = 'http://localhost:8080/api/v1';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/stats/overview`);
      if (!res.ok) throw new Error('Network response was not ok');
      return res.json();
    },
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/audit/recent`);
      if (!res.ok) throw new Error('Network response was not ok');
      return res.json();
    },
  });
}
