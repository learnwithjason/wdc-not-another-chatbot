import { LoaderFunctionArgs, json, type MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { DataAPIClient } from '@datastax/astra-db-ts';

export const meta: MetaFunction = () => {
	return [
		{ title: 'New Remix App' },
		{ name: 'description', content: 'Welcome to Remix!' },
	];
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
	const client = new DataAPIClient(process.env.ASTRA_DB_TOKEN!);
	const db = client.db(process.env.ASTRA_DB_ENDPOINT!);

	const collection = await db.collection('videos');
	const searchCollection = await db.collection('search');

	// do a search
	const currentEpisodeSlug = params.slug;

	const searchVector = await searchCollection.findOne({
		slug: currentEpisodeSlug,
	});

	const { $vector, chunk, ...episode } = await collection.findOne({
		slug: currentEpisodeSlug,
	});

	if (!searchVector) {
		return json({ error: 'no search vector found' });
	}

	const related = await collection.find(
		{ slug: { $ne: currentEpisodeSlug } },
		{ vector: searchVector.$vector, includeSimilarity: true, limit: 100 },
	);

	const relatedEpisodes: Record<
		string,
		{ title: string; slug: string; count: number }
	> = {};

	for await (const relEp of related) {
		if (relatedEpisodes[relEp.slug]) {
			relatedEpisodes[relEp.slug].count += 1;
			continue;
		}

		relatedEpisodes[relEp.slug] = {
			title: relEp.title,
			slug: relEp.slug,
			count: 1,
		};
	}

	return json({
		episode,
		related: Object.values(relatedEpisodes).sort((a, b) => b.count - a.count),
	});
};

export default function Index() {
	const { episode, related } = useLoaderData<typeof loader>();

	return (
		<>
			<div className="video">
				<iframe
					width="560"
					height="315"
					src={`https://www.youtube.com/embed/${episode.youtube.id}`}
					title="YouTube video player"
					frameBorder="0"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
					referrerPolicy="strict-origin-when-cross-origin"
					allowFullScreen
				></iframe>
				<h1>{episode.title}</h1>
				<p>{episode.description}</p>
			</div>

			<h2>Related Episodes</h2>
			<aside className="related">
				{related.slice(0, 3).map((relEp) => {
					return (
						<div key={relEp.slug} className="episode">
							<img
								src={`https://www.learnwithjason.dev/${relEp.slug}/w_600/poster.jpg`}
								alt={relEp.title}
							/>
							<p>
								<a href={`/${relEp.slug}`}>{relEp.title}</a>
							</p>
						</div>
					);
				})}
			</aside>
		</>
	);
}
