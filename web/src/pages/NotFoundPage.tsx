import { ButtonLink } from '../components/ui/Button';
import { IconLeaf } from '../components/ui/Icons';

export function NotFoundContent({
  title = 'Page not found',
  message = 'This page does not exist. It may have been moved, or the link is incorrect.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
        <IconLeaf size={28} />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-ink-muted">{message}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <ButtonLink to="/" variant="primary">
          Go to overview
        </ButtonLink>
        <ButtonLink to="/data">Browse all samples</ButtonLink>
      </div>
    </div>
  );
}

export default function NotFoundPage() {
  return (
    <>
      <title>Not found · Sylvan</title>
      <NotFoundContent />
    </>
  );
}
