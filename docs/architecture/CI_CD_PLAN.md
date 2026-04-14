# CI/CD and Secret Management Plan

## Continuous Integration (CI)
- **Triggers**: Automated execution on Pull Requests to `main` or release branches.
- **Stages**:
  1. **Linting & Formatting**: Enforce strict code style and type safety.
  2. **Unit & Integration Tests**: Verify application logic isolated from external infrastructure.
  3. **Security Scans**: 
     - **SAST**: Static Application Security Testing against source code.
     - **SCA**: Software Composition Analysis to catch vulnerable NPM/Go dependencies.
     - **Secret Scanning**: Prevent accidental commit of API keys or credentials.
  4. **Build**: Containerize application (Docker).
  5. **Image Scan**: Scan generated container images for OS-level CVEs using Trivy or Clair.
  6. **Publish**: Push approved, tagged images to a secure private Container Registry.

## Continuous Deployment (CD)
- **Pipeline Strategy**: GitOps approach managed via ArgoCD or Flux (pull-based deployment) or GitHub Actions/GitLab CI (push-based).
- **Environments Flow**:
  - `dev`: Automatic deployment on merge to `main`.
  - `staging`: Manual approval gate. Deploys release candidates.
  - `prod`: Strict manual approval gate. Deploys verified release candidates.
- **Infrastructure as Code (IaC)**: Terraform or Pulumi definitions are version-controlled alongside application code and applied via dedicated IaC pipelines, decoupled from application deploy pipelines.

## Secret Storage
- **Architecture**: Managed Secrets Engine (e.g., HashiCorp Vault, AWS Secrets Manager, or Azure Key Vault).
- **Core Principles**:
  - NO secrets in code repositories. Ever.
  - Runtime injection: Secrets are pulled and injected into containers at runtime as environment variables or temporal in-memory volumes (using tools like External Secrets Operator).
  - Rotation: Automated secret rotation configured for database credentials and 3rd party API keys.
  - Scope isolation: Least privilege access enforced via IAM roles. Dev environments absolutely cannot access or decrypt Staging/Prod secrets.
