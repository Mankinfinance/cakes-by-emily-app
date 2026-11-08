import Link from "next/link";
import { connection } from "next/server";
import { CakePreview } from "@/components/CakePreview";
import { getRepo } from "@/lib/data";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { BUSINESS } from "@/lib/config";

const steps = [
  { title: "Design it", body: "Choose the size, flavour, finish, colours and decorations. The price updates as you go." },
  { title: "Pick a date and time", body: "See which dates are free and choose a 30 minute pickup window." },
  { title: "Pay your deposit", body: "A secure deposit through Stripe locks in your date. The balance is due before pickup." },
  { title: "Watch it come to life", body: "Follow your cake's progress with updates and photos from Emily." },
];

export default async function Home() {
  await connection();
  const repo = await getRepo();
  const [reviews, settings] = await Promise.all([repo.listReviews({ status: "approved" }), repo.getSettings()]);
  const shown = reviews.filter((r) => r.consentToPublish).slice(0, 6);
  const photos = await Promise.all(shown.map((r) => (r.photoPath ? repo.mediaUrl(r.photoPath) : Promise.resolve(null))));
  const google = settings.reviewUrl || process.env.REVIEW_URL || "";
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-12 sm:grid-cols-2 sm:py-20">
          <div>
            <p className="font-script text-3xl text-rose">Made with love in {BUSINESS.suburb}</p>
            <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">Custom celebration cakes, designed by you</h1>
            <p className="mt-4 text-lg text-muted">
              Birthdays, first birthdays, baby showers, baptisms, engagements and more. Design your cake, see the price straight away and
              book your pickup time in a few minutes.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/order" className="btn btn-primary">
                Design your cake
              </Link>
              <a href={`https://instagram.com/${BUSINESS.instagram}`} className="btn btn-ghost" target="_blank" rel="noopener noreferrer">
                See more on Instagram
              </a>
            </div>
          </div>
          <div className="card mx-auto w-full max-w-sm p-6">
            <CakePreview
              tiers={2}
              colour="#F2C4CE"
              finish="fin-drip"
              decorations={["dec-fresh-flowers", "dec-topper", "dec-gold-leaf"]}
              topperText="Happy Birthday"
              className="w-full"
            />
          </div>
        </section>

        <section id="how" className="bg-white py-14">
          <div className="mx-auto max-w-5xl px-4">
            <h2 className="font-serif text-3xl">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={s.title} className="card p-5">
                  <span className="font-serif text-2xl text-rose">{i + 1}</span>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-4 pt-14 sm:grid-cols-2">
          <Link href="/boxes" className="card p-6 hover:border-rose" data-testid="home-boxes">
            <h2 className="font-serif text-2xl">Seasonal boxes</h2>
            <p className="mt-1 text-muted">Limited pre-order treat boxes for Christmas, teachers and Mother&apos;s Day.</p>
          </Link>
          <Link href="/vouchers" className="card p-6 hover:border-rose" data-testid="home-vouchers">
            <h2 className="font-serif text-2xl">Gift vouchers</h2>
            <p className="mt-1 text-muted">Emailed instantly, and spent on any cake.</p>
          </Link>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-4 pt-6 sm:grid-cols-2">
          <Link href="/classes" className="card p-6 hover:border-rose" data-testid="home-classes">
            <h2 className="font-serif text-2xl">Cake and Sip classes</h2>
            <p className="mt-1 text-muted">Learn buttercream florals or drip cakes, BYO drinks. Kids&apos; classes and private parties too.</p>
          </Link>
          <Link href="/corporate" className="card p-6 hover:border-rose" data-testid="home-corporate">
            <h2 className="font-serif text-2xl">Corporate orders</h2>
            <p className="mt-1 text-muted">Logo cookies and cupcakes for your team or clients.</p>
          </Link>
        </section>

        {shown.length > 0 && (
          <section className="mx-auto max-w-5xl px-4 pt-14" data-testid="home-reviews">
            <h2 className="font-serif text-3xl">Kind words</h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((r, i) => (
                <li key={r.id} className="card overflow-hidden">
                  {photos[i] && (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={photos[i]!} alt={`Cake reviewed by ${r.displayName}`} className="h-48 w-full object-cover" />
                  )}
                  <div className="p-5">
                    <p className="text-gold" aria-label={`${r.rating} out of 5 stars`}>{"★".repeat(r.rating)}<span className="text-line">{"★".repeat(5 - r.rating)}</span></p>
                    {r.text && <p className="mt-2 text-sm">&ldquo;{r.text}&rdquo;</p>}
                    <p className="mt-2 text-sm font-semibold">{r.displayName}</p>
                  </div>
                </li>
              ))}
            </ul>
            {google && (
              <p className="mt-4 text-sm">
                <a href={google} className="underline" target="_blank" rel="noopener noreferrer">
                  Read more reviews or leave one on Google
                </a>
              </p>
            )}
          </section>
        )}

        <section className="mx-auto max-w-5xl px-4 py-14">
          <div className="card flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-serif text-2xl">Allergies or dietary needs?</h2>
              <p className="mt-1 text-muted">
                Filter by nut-free, egg-free, dairy-free or gluten-friendly in the builder. Every flavour lists its allergens.
              </p>
            </div>
            <Link href="/order" className="btn btn-primary shrink-0">
              Start designing
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
