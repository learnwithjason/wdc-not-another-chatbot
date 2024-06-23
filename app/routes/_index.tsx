import { json, type MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { DataAPIClient } from '@datastax/astra-db-ts';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import OpenAI from 'openai';

const splitter = new RecursiveCharacterTextSplitter({
	chunkSize: 512,
	chunkOverlap: 100,
});

export const meta: MetaFunction = () => {
	return [
		{ title: 'New Remix App' },
		{ name: 'description', content: 'Welcome to Remix!' },
	];
};

export const loader = async () => {
	const response = await fetch(
		'https://www.learnwithjason.dev/api/v2/episodes',
	);
	const episodes = await response.json();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const promises = episodes.map((ep: any) => {
		return fetch(
			`https://www.learnwithjason.dev/api/v2/episode/${ep.slug}/?transcript=true`,
		).then((res) => res.json());
	});

	let episodesWithTranscripts = await Promise.all(promises);

	const openai = new OpenAI();

	const client = new DataAPIClient(process.env.ASTRA_DB_TOKEN!);
	const db = client.db(process.env.ASTRA_DB_ENDPOINT!);

	const collection = await db.collection('videos');
	const searchCollection = await db.collection('search');

	episodesWithTranscripts = []; //episodesWithTranscripts.slice(10, 20);

	// break up each transcript into chunks
	for await (const ep of episodesWithTranscripts) {
		const { transcript, ...epDetails } = ep;
		const chunks = await splitter.splitText(transcript);

		const searchEmbedding = await openai.embeddings.create({
			model: 'text-embedding-3-small',
			input: [
				ep.title,
				ep.description,
				ep.guest.name,
				ep.tags.map((t: { label: unknown }) => t.label).join(', '),
			].join(' '),
			encoding_format: 'float',
		});

		await searchCollection
			.insertOne({
				$vector: searchEmbedding.data.at(0)?.embedding,
				slug: ep.slug,
			})
			.catch((err) => {
				console.log('failed to insert search embedding for episode:');
				console.log(ep.slug);
				console.error(err);
			})
			.finally(() => {
				console.log(`added search embeddings for ${ep.slug}`);
			});

		for await (const chunk of chunks) {
			// create embeddings for each episode
			const embedding = await openai.embeddings.create({
				model: 'text-embedding-3-small',
				input: chunk,
				encoding_format: 'float',
			});

			const vector = embedding.data.at(0)?.embedding;

			await collection
				.insertOne({
					$vector: vector,
					...epDetails,
					chunk,
				})
				.catch((err) => {
					console.log('failed to insert embedding for chunk:');
					console.log(ep.slug);
					console.log(chunk);
					console.error(err);
				})
				.finally(() => {
					console.log(`added embeddings for ${ep.slug}`);
				});
		}
	}

	// get all episodes
	const cursor = await searchCollection.find({});
	const allEpisodes = [];

	for await (const doc of cursor) {
		allEpisodes.push(doc);
	}

	return json({
		episodes: allEpisodes,
	});
};

export default function Index() {
	const { episodes } = useLoaderData<typeof loader>();

	return (
		<>
			<h1>oh no</h1>
			<ul>
				{episodes.map((ep) => (
					<li key={ep.slug}>
						<a href={`/${ep.slug}`}>{ep.slug}</a>
					</li>
				))}
			</ul>
		</>
	);
}
