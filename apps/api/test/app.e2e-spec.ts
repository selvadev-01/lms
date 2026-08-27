import {
  CollectionController,
  LoanCollectionController,
} from './../src/loans/collection/collection.controller';
import { LoanApplicationController } from './../src/loans/applications/loan-application.controller';
import { LoanApplicationDocumentController } from './../src/loans/applications/loan-application-document.controller';
import { ReportsController } from './../src/reports/reports.controller';
import { SavedReportController } from './../src/reports/saved/saved-report.controller';

/**
 * Routing-level checks that the unit specs structurally cannot make.
 *
 * A service spec calls a method directly, so it proves what the method does and
 * says nothing about whether a request ever reaches it. The hazards below live
 * entirely in the wiring:
 *
 * **Literal segments must be declared before parameterised ones.** Nest matches
 * in declaration order, so a `@Get(':applicationId')` written above
 * `@Post('emi-preview')` would silently swallow the literal path — the preview
 * request would arrive at `getById` with `applicationId` set to the string
 * `"emi-preview"`. That fails as a confusing 404 for a row that does not exist,
 * not as an obvious routing error, and no service test can see it.
 *
 * This replaces the generated scaffold, which asserted `GET /` returns
 * `"Hello World!"`. That test was doubly wrong: the app sets a global prefix of
 * `api/v1`, and the scaffold never applied it — so it was asserting against a
 * route the real application does not serve.
 *
 * Deliberately no database: these read the metadata Nest builds from the
 * decorators, so they run in CI without a seeded Postgres. Behaviour that needs
 * real rows is covered by the Playwright suite in `apps/web/e2e`.
 */

/**
 * The `path` metadata Nest stores for each controller method, in declaration
 * order — which is the order Nest itself matches them in.
 */
function routesOf(prototype: object): Array<{ method: string; path: string }> {
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = (prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') return null;

      const path = Reflect.getMetadata('path', handler) as string | undefined;
      if (path === undefined) return null;

      return { method: name, path };
    })
    .filter(
      (entry): entry is { method: string; path: string } => entry !== null,
    );
}

describe('loan application routing', () => {
  it('declares the literal emi-preview path before any parameterised one', () => {
    const routes = routesOf(LoanApplicationController.prototype);

    const preview = routes.findIndex((route) => route.path === 'emi-preview');
    const firstParameterised = routes.findIndex((route) =>
      route.path.includes(':'),
    );

    expect(preview).toBeGreaterThanOrEqual(0);
    expect(firstParameterised).toBeGreaterThanOrEqual(0);
    // Reversing these two declarations routes every preview request into
    // `getById` as an application id of "emi-preview".
    expect(preview).toBeLessThan(firstParameterised);
  });

  it('exposes the whole application lifecycle', () => {
    const paths = routesOf(LoanApplicationController.prototype).map(
      (route) => route.path,
    );

    // Each of these is a transition the story names. A missing one means a
    // lifecycle step is unreachable however well its service is tested.
    for (const step of [
      ':applicationId/submit',
      ':applicationId/start-review',
      ':applicationId/request-info',
      ':applicationId/modify-terms',
      ':applicationId/approve',
      ':applicationId/reject',
    ]) {
      expect(paths).toContain(step);
    }
  });

  it('nests every document route under an application', () => {
    const controllerPath = Reflect.getMetadata(
      'path',
      LoanApplicationDocumentController,
    ) as string;

    // Scope resolves through the application, so a document route that did not
    // carry the application id could not re-check it (Scenario 20).
    expect(controllerPath).toContain(':applicationId');
  });
});

describe('collection routing', () => {
  it('declares every literal collection path before any parameterised one', () => {
    const routes = routesOf(CollectionController.prototype);

    const firstParameterised = routes.findIndex((route) =>
      route.path.includes(':'),
    );

    expect(firstParameterised).toBeGreaterThanOrEqual(0);

    // Each of these would otherwise arrive at `detail` with `collectionId` set
    // to the literal string, and fail ParseUUIDPipe as a confusing 400.
    for (const literal of ['readiness', 'preview-allocation', 'sync']) {
      const index = routes.findIndex((route) => route.path === literal);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(firstParameterised);
    }
  });

  it('exposes the collection surface the module needs', () => {
    const paths = routesOf(CollectionController.prototype).map(
      (route) => route.path,
    );

    for (const route of [
      'readiness',
      'preview-allocation',
      'sync',
      ':collectionId',
      ':collectionId/ledger',
      ':collectionId/reverse',
    ]) {
      expect(paths).toContain(route);
    }
  });

  it('exposes no edit or delete route for a collection', () => {
    const routes = routesOf(CollectionController.prototype);

    // Rules 21, 22 and 44: a posted collection is immutable and financial
    // records are retained. The database enforces both, but a route that
    // existed at all would be a surface someone could later relax. Its absence
    // is deliberate — see the service's class comment on Scenario 24.
    for (const route of routes) {
      const handler = (
        CollectionController.prototype as unknown as Record<string, unknown>
      )[route.method] as object;
      const method = Reflect.getMetadata('method', handler) as
        number | undefined;

      // RequestMethod: 0 GET, 1 POST, 2 PUT, 3 DELETE, 4 PATCH.
      expect(method).not.toBe(2);
      expect(method).not.toBe(3);
      expect(method).not.toBe(4);
    }
  });

  it('keeps the loan-keyed collection route on its own controller', () => {
    // `loans/:loanId/collections` cannot live on `@Controller('loans/collections')`.
    // It is a second controller, and `loans.module.ts` registers it *after*
    // CollectionController so the literal two-segment prefix wins.
    expect(Reflect.getMetadata('path', CollectionController)).toBe(
      'loans/collections',
    );
    expect(Reflect.getMetadata('path', LoanCollectionController)).toBe('loans');

    const paths = routesOf(LoanCollectionController.prototype).map(
      (route) => route.path,
    );
    expect(paths).toEqual([':loanId/collections']);
  });
});

describe('reports routing (Module 15)', () => {
  it('pairs an export route with every tabular report', () => {
    const paths = routesOf(ReportsController.prototype).map(
      (route) => route.path,
    );

    // A category whose report exists but whose export does not is a screen with
    // a download button that 404s. The dashboard is deliberately absent: it is
    // a KPI panel, not a table, and there is nothing to put in a file.
    for (const category of [
      'portfolio',
      'applications',
      'disbursals',
      'collections',
      'field-collections',
      'overdue-recovery',
      'financial',
    ]) {
      expect(paths).toContain(category);
      expect(paths).toContain(`${category}/export`);
    }

    expect(paths).toContain('dashboard');
  });

  it('declares every report route as a GET', () => {
    // Rules 5, 6 and 17: a report is a read-only view, and Scenario 46 makes
    // editing a reported value a refusal. A write verb appearing on this
    // controller would be a way to try.
    for (const name of Object.getOwnPropertyNames(
      ReportsController.prototype,
    ).filter((entry) => entry !== 'constructor')) {
      const handler = (
        ReportsController.prototype as unknown as Record<string, unknown>
      )[name];
      if (typeof handler !== 'function') continue;
      if (Reflect.getMetadata('path', handler) === undefined) continue;

      // RequestMethod: 0 GET, 1 POST, 2 PUT, 3 DELETE, 4 PATCH.
      expect(Reflect.getMetadata('method', handler)).toBe(0);
    }
  });

  it('keeps saved-report writes on their own controller, under a literal prefix', () => {
    // `reports/saved` must be its own controller rather than a route on
    // ReportsController: a `@Get(':id')` there would swallow `saved`, and the
    // separation is also what keeps the read-only assertion above meaningful.
    expect(Reflect.getMetadata('path', ReportsController)).toBe('reports');
    expect(Reflect.getMetadata('path', SavedReportController)).toBe(
      'reports/saved',
    );
  });

  it('declares the literal deactivate path so it cannot be read as an id', () => {
    const routes = routesOf(SavedReportController.prototype);

    const deactivate = routes.findIndex(
      (route) => route.path === ':reportDefinitionId/deactivate',
    );
    const bareParam = routes.findIndex(
      (route) => route.path === ':reportDefinitionId',
    );

    expect(deactivate).toBeGreaterThanOrEqual(0);
    expect(bareParam).toBeGreaterThanOrEqual(0);
  });
});

/*
 * Deliberately not booting `AppModule` here. It opens a Prisma connection at
 * init, so a boot test fails on any machine without Postgres — which is exactly
 * how the generated scaffold came to be broken without anyone noticing. The
 * booted application against a seeded database is the Playwright suite's job.
 */
