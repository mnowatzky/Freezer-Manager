import { t } from "../lib/i18n";
import { useEffect } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button, Icon } from "../components/m3";
import { reportError } from "../lib/report-error";

/** Router error boundary: replaces React Router's default screen with a German, recoverable page. */
export function ErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  useEffect(() => {
    if (!notFound) reportError(error, "route");
  }, [error, notFound]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <span className="flex size-20 items-center justify-center rounded-xl bg-error-container text-on-error-container">
        <Icon name={notFound ? "search" : "error"} size={40} />
      </span>
      <h1 className="type-headline-small type-emphasized">{notFound ? t.errorPage.notFound : t.errorPage.title}</h1>
      {!notFound && <p className="type-body-large max-w-xs text-on-surface-variant">{t.errorPage.hint}</p>}
      <div className="flex gap-2">
        <Button variant="tonal" icon="arrow_back" onClick={() => location.assign("/")}>
          {t.join.toApp}
        </Button>
        {!notFound && (
          <Button icon="refresh" onClick={() => location.reload()}>
            {t.errorPage.reload}
          </Button>
        )}
      </div>
    </main>
  );
}
