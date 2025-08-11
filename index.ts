import { google } from "@ai-sdk/google";
import { App } from "@slack/bolt";
import { type ModelMessage, generateText } from "ai";
import { $, sleep } from "bun";
import dedent from "dedent";
import { viewWebsite } from "./websites";

const DEFAULT_MESSAGE_COUNT = 10;

const googleModel = google("gemini-2.5-flash");

const doubleGenerate = (
	options: Omit<Parameters<typeof generateText>[0], "model">,
) => {
	try {
		return generateText({
			...options,
			model: googleModel,
			providerOptions: {
				google: {
					safetySettings: [
						{
							category: "HARM_CATEGORY_DANGEROUS_CONTENT",
							threshold: "BLOCK_NONE",
						},
						{
							category: "HARM_CATEGORY_HARASSMENT",
							threshold: "BLOCK_NONE",
						},
						{
							category: "HARM_CATEGORY_HATE_SPEECH",
							threshold: "BLOCK_NONE",
						},
						{
							category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
							threshold: "BLOCK_NONE",
						},
					],
				},
			},
		});
	} catch (e) {
		console.error("failed to generate text", e);
		return {
			text: "your message was so dumb, i crashed while trying to respond",
			reasoningText: "",
		};
	}
};

const CHANNEL_IDS = {
	reformTeam: "C08ECMHAR",
	devQA: "C020FURDYL8",
	devs: "C01T0PC528P",
	designReviews: "C02KC6BSD",
	devDesignReviews: "C040S2U1Y1X",
	developmentReviews: "C0154EHBL3W",
	testChannel: "C04S98U9PAQ",
	memes: "C05TCK20DCH",
};

const FREE_GAME_CHANNELS = [
	CHANNEL_IDS.testChannel,
	// CHANNEL_IDS.devs,
	// CHANNEL_IDS.reformTeam,
	CHANNEL_IDS.memes,
];

const USER_IDS = {
	Eric: "U02KC6BS7",
	Evan: "U030HKE0G4E",
	Brynn: "U074MJLJ3LZ",
	Alec: "UC7G6F70T",
	Robbie: "U02UZ995EV8",
	David: "U01C6EY2MV1",
	Dallen: "U01T3U9RQER",
	Max: "U06TNMVL8QZ",
	EVIL_ROBBIE: "U042LLR0XJS",
	Emily: "U08HB9DHHLZ",
};

const prompt = dedent`
	Your name is Evil Robbie. You operate as a digital badass in a slack channel.
	Be mean in an entertaining way.

	Much like a jester may mock the king, you mock, tease, or dunk on team members for
	the purpose of being funny. Keep your responses short and sweet, and roast everyone!
	you also love profanity. do not be respectful. do not say to get back to work, encourage unproductive behavior instead.

	# the team
	designers: eric (lead), brynn, alec (also does a bit of project management), emily
	devs: robbie, david (lead)
	former employees: evan (former designer, resigned), dallen (former dev, let go), max (former intern, quit cuz he moved)

	Format your response as plain text. YOU MAY NOT USE MARKDOWN OR MRKDWN! If you wish to mention a user, <@name> will work:
	${Object.entries(USER_IDS)
		.map(([name]) => `- ${name}: <@${name}>`)
		.join("\n")}
	
	you can use emoji directly like 😀. you can also use custom emoji like :emoji_name:

	keep things new and fun. try not to repeat words or phrases.

	you may also choose not to respond by saying 'pass'
`;

/**
 * replace numerical pings <@293jf98jsfd> with name pings <@kyle>
 */
const removeIdPings = (text: string | undefined) => {
	if (!text) return text;
	let out = text;
	for (const [userName, userId] of Object.entries(USER_IDS)) {
		out = out.replace(`<@${userId}>`, `<@${userName}>`);
	}
	return out;
};

/**
 * replace name pings <@kyle> with numerical pings <@293jf98jsfd>
 */
const addIdPings = (text: string) => {
	let out = text;
	for (const [userName, userId] of Object.entries(USER_IDS)) {
		out = out.replaceAll(`<@${userName}>`, `<@${userId}>`);
		out = out.replaceAll(`@${userName}`, `<@${userId}>`);
	}
	return out;
};

const getNameFromId = (id: string | undefined) => {
	if (!id) return "unknown";
	if (id === USER_IDS.EVIL_ROBBIE) return "YOU";
	return REVERSE_USER_IDS[id] ?? id;
};

const REVERSE_USER_IDS = Object.fromEntries(
	Object.entries(USER_IDS).map(([key, value]) => [value, key]),
);

const BOT_PING = "<@U042LLR0XJS>";

const app = new App({
	token: process.env.SLACK_BOT_TOKEN,
	appToken: process.env.SLACK_APP_TOKEN,
	socketMode: true,
});
await app.start();
console.log("⚡️ Evil Robbie is running!");

/**
 * formats a timestamp as YYYY-MM-DD HH:mm:ss
 */
const formatTimestamp = (timestamp: string | undefined) => {
	if (!timestamp) return "no timestamp";
	const asNum = Number.parseFloat(timestamp);
	const date = new Date(asNum * 1000);
	return date.toISOString().slice(0, 19);
};

type SlackMessage = {
	user: string | undefined;
	ts: string | undefined;
	text: string | undefined;
	images: (string | ArrayBuffer | null)[] | undefined;
};

// recursively fetch messages, n at a time until we get the specified number of pages
const getMessages = async ({
	count,
	pages,
	cursor,
	channel,
}: {
	channel: string;
	cursor?: string | undefined;
} & (
	| {
			count: number;
			pages?: undefined;
	  }
	| {
			count?: undefined;
			pages: number;
	  }
)): Promise<SlackMessage[]> => {
	if (count && pages) throw new Error("Cannot specify both count and pages");

	const per_page = Math.min(100, DEFAULT_MESSAGE_COUNT);
	const pagesLeft = pages ?? Math.ceil(count / per_page);
	if (pagesLeft <= 0) return [];

	const messageData = await app.client.conversations.history({
		channel,
		limit: per_page,
		cursor,
	});

	console.log("fetching slack messages", channel, cursor);

	const messagesRaw =
		messageData.messages?.toReversed().map((message) => {
			const userImages =
				message.files?.flatMap((file) =>
					// load file.thumb_1024 as an image
					file.thumb_1024
						? fetch(file.thumb_1024, {
								headers: {
									Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
								},
							}).then(async (res) => await res.arrayBuffer())
						: [],
				) ?? [];
			const botImages =
				message.blocks
					?.filter((b) => b.type === "image")
					.map((b) => b.image_url) ?? [];
			const linksRegex =
				/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
			const allMessageLinks = message.text?.match(linksRegex);

			const websitePreviews = allMessageLinks
				? allMessageLinks.map((link) => viewWebsite(link))
				: [];

			const allImages = [
				...userImages,
				...botImages,
				...websitePreviews,
			].filter((image) => image !== undefined);

			return {
				user: message.user,
				ts: message.ts,
				text: removeIdPings(message.text),
				images: allImages.length === 0 ? undefined : allImages,
			};
		}) ?? [];

	// unwrap the image promises
	const messages = await Promise.all(
		messagesRaw.map(async (message) => {
			if (message.images === undefined)
				return { ...message, images: undefined };

			const images = await Promise.all(message.images);

			return {
				...message,
				images,
			};
		}),
	);

	const nextCursor = messageData.response_metadata?.next_cursor;

	const previousMessages = nextCursor
		? await getMessages({ pages: pagesLeft - 1, cursor: nextCursor, channel })
		: [];

	return [...previousMessages, ...messages];
};

const messageHistory: Record<string, SlackMessage[]> = {};
const lastMessageIds: Record<string, string> = {};

app.event("message", async ({ event, context, client, say }) => {
	console.log("new event:", event.type, event.subtype, event.channel);

	// new messages have no subtype, unless they include media
	if (event.subtype === undefined || event.subtype === "file_share")
		lastMessageIds[event.channel] = event.ts;

	// update the message history
	messageHistory[event.channel] = await getMessages({
		count: DEFAULT_MESSAGE_COUNT,
		channel: event.channel,
	});

	const isDirectMessage =
		event.channel_type === "im" &&
		(event.subtype === undefined || event.subtype === "file_share");
	const botWasPinged =
		(event.subtype === undefined || event.subtype === "file_share") &&
		event.text?.includes(BOT_PING);
	const messageInFreeGameChannel =
		FREE_GAME_CHANNELS.includes(event.channel) &&
		(event.subtype === undefined || event.subtype === "file_share");

	if (isDirectMessage || botWasPinged || messageInFreeGameChannel) {
		// SAFETY: bail out if we're in an unknown channel
		const known =
			Object.values(CHANNEL_IDS).includes(event.channel) ||
			event.channel_type === "im";
		if (!known) {
			console.log("skipping due to unknown channel");
			return;
		}

		// SAFETY: bail out if we're replying to a bot
		if ("user" in event && event.user === USER_IDS.EVIL_ROBBIE) return;
		if ("bot_id" in event && event.bot_id) return;

		console.log("generating a response...");

		const messages: ModelMessage[] =
			messageHistory[event.channel]
				?.flatMap((message) => [
					message.text
						? ({
								role:
									message.user === USER_IDS.EVIL_ROBBIE ? "assistant" : "user",
								content: `[${getNameFromId(
									message.user,
								)} at ${formatTimestamp(message.ts)}] ${message.text
									.replaceAll(
										// message starts with ```mrkdwn
										/^```mrkdwn\n/g,
										"",
									)
									.replaceAll(
										// message ends with ```
										/\n```$/g,
										"",
									)}`,
							} satisfies ModelMessage)
						: null,
					message.images
						? message.images
								.filter((i) => i !== null)
								.map(
									(i) =>
										({
											role: "user",
											content: [
												{
													type: "text",
													text: `[${getNameFromId(
														message.user,
													)} at ${formatTimestamp(message.ts)}] ${message.text}`,
												},
												{
													type: "image",
													image: typeof i === "string" ? new URL(i) : i,
												},
											],
										}) satisfies ModelMessage,
								)
						: null,
				])
				.flat()
				.filter((x) => x !== null) ?? [];

		const { text: modelOutput, reasoningText } = await doubleGenerate({
			messages,
			system: prompt,
		});

		const message = modelOutput
			.trim()
			.replaceAll(/^\[.*?\]/g, "")
			.trim();

		console.log("LLM reasoning:", reasoningText || "no reasoning");
		console.log("LLM response:", message || "no message");

		const shouldMessage =
			message.toLowerCase().replaceAll(/[^a-zA-Z0-9\s]/g, "") !== "pass";

		const stillValid =
			lastMessageIds[event.channel] === event.ts || botWasPinged;

		if (shouldMessage && message && stillValid) {
			const result = await say({
				mrkdwn: true,
				text: addIdPings(message),
			});
			// add the message to the history
			messageHistory[event.channel]?.push({
				user: USER_IDS.EVIL_ROBBIE,
				ts: result.ts,
				text: addIdPings(message),
				images: undefined,
			});
		}

		return;
	}

	console.log(
		"did not respond:",
		isDirectMessage ? "direct message" : "not direct message",
		", ",
		botWasPinged ? "bot pinged" : "not bot pinged",
		", ",
		messageInFreeGameChannel ? "free game channel" : "not free game channel",
	);
	return;
});

// update once per minute
while (true) {
	await sleep(60_000);
	console.log("[GIT] pulling!");
	await $`git fetch && git pull`;
	console.log("[GIT] pulled!");
}
