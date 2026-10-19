# Infrastructure usage and profit evidence

`GET /api/v1/super/business/provider-usage` is restricted to authenticated SUPER_ADMIN sessions. It reads provider usage on demand, shares concurrent requests and caches results for five minutes. No background polling or provider mutations are added. Failed readings are unknown, never zero; credentials and provider error bodies never leave the API. Every HTTP request is bounded across response-body consumption and limited to 8 MiB.

## Runtime configuration

Set these only on the API service using the provider's smallest suitable billing-read scope. Do not enter or commit secrets in source files.

| Provider | Server variables | Meaning |
| --- | --- | --- |
| Vercel | `BUSINESS_VERCEL_TOKEN`, `BUSINESS_VERCEL_TEAM_ID`, optional `BUSINESS_VERCEL_PROJECT_ID` | Explicit team usage, optionally filtered to one project's charge tags. UTC current calendar month through the observation time. |
| Railway | `BUSINESS_RAILWAY_TOKEN`, `BUSINESS_RAILWAY_WORKSPACE_ID` | Authoritative currentUsage for the explicitly selected workspace's provider billing period. Includes other projects in that workspace. An account/workspace token is required; project tokens do not have workspace billing access. |
| Supabase | None | Recorded invoice cost; internal capacity measurements remain live. The public Management API does not expose organization billing totals in its published schema. |

Vercel uses the same `/v1/billing/charges` JSON-lines interface as its installed CLI `usage` command; sums `BilledCost` in USD and rounds after aggregation. Unattributed charges are excluded when selecting a project, so a project reading is partial. Railway uses its official CLI's WorkspaceUsageContext GraphQL selection, without converting resource metrics using guessed prices.

Provider accrued usage is separate from the manually recorded monthly recurring cost register. It is not added to that total: doing so would double-count registered bills. Usage may exclude base plan fees, taxes, credits, services in other accounts and late-arriving charges. Profit remains an estimate until all relevant expenses and contract prices are entered.

References verified during implementation: [Vercel usage command](https://vercel.com/docs/cli/usage), [Railway public API](https://docs.railway.com/integrations/api), [Railway CLI usage source](https://github.com/railwayapp/cli/blob/master/src/commands/usage.rs), [Supabase Management API](https://supabase.com/docs/reference/api/introduction). Live credential-based verification remains a release configuration check; no provider tokens or production charges are used by the tests.
