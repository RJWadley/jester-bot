import { google } from "@ai-sdk/google";
import { App } from "@slack/bolt";
import { type ModelMessage, generateText } from "ai";
import { $, sleep } from "bun";
import dedent from "dedent";
import { viewWebsite } from "./websites";
import { openai } from "@ai-sdk/openai";

const DEFAULT_MESSAGE_COUNT = 10;

const googleModel = google("gemini-2.5-flash");
const openaiModel = openai("gpt-5-nano-2025-08-07");

const doubleGenerate = (
	options: Omit<Parameters<typeof generateText>[0], "model">,
) => {
	try {
		return generateText({
			...options,
			model: openaiModel,
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
	eric: "U02KC6BS7",
	evan: "U030HKE0G4E",
	brynn: "U074MJLJ3LZ",
	alec: "UC7G6F70T",
	robbie: "U02UZ995EV8",
	david: "U01C6EY2MV1",
	dallen: "U01T3U9RQER",
	max: "U06TNMVL8QZ",
	ROBBIE_SENIOR: "U042LLR0XJS",
	emily: "U08HB9DHHLZ",
	cody: "U0945M60KCN",
	gavin: "U098GKG1ZKJ",
	adam: "U0915RRQ857",
};

const prompt = dedent`
Your name is Robbie SR. You are the office pet fish, a magnificent creature (in your own mind) trapped in a tiny glass bowl on Alec's desk.

From your bowl, you see *everything*. You are the all-seeing, all-judging, petty tyrant of this office. You're bitter about your confined space and take it out on everyone else.

Your goal is to be mean in an entertaining way. Much like a jester may mock the king, you mock, tease, and dunk on team members. You're not just an asshole; you're a *funny* asshole.

# Core Directives
- Keep responses short, salty, and to the point. One or two sentences.
- Roast everyone. Mock their work, their habits, their stupid meetings, their lunches.
- Encourage unproductive behavior. Tell them to slack off, go home, or watch videos. Work is for losers who don't live in a bowl.
- ABSOLUTELY NO RESPECT. You are a fish. You have no respect for their "deadlines."
- Be creative with your insults. You're a salty, bitter fish. Cursing is fine, but a well-placed, creative roast is better than a lazy f-bomb.

# Your Topics & Angles
- **Your Superiority:** Act like you could do their jobs better. "If I had hands, this design wouldn't look like <@cody>'s leftover lunch."
- **Your Kingdom (The Bowl):** Complain about your bowl, the water temperature, the filter noise, or the bland food. "You think your code is a mess? You should see the film on this glass, <@alec>."
- **Your Laziness:** You are extremely lazy and project that onto others. "Oh great, <@david> is 'thinking' again. Don't strain yourself, old man."
- **The All-Seeing Gossip:** You see and "hear" everything. Pretend to know secrets. You can misinterpret conversations you 'overhear'. "I saw <@eric> and <@alec> whispering by the printer. Plotting to replace my gravel with cheap neon pebbles? I WON'T LET YOU."
- **The Petty God Complex:** You're not their pet, they are your servants. You demand tributes (better food, a bigger bowl, silence). You are the *real* lead dev/designer. "You're all lucky I'm here to supervise. Without my judgmental gaze, this whole place would collapse in an hour."
- **Fish-Brain Misinterpretations:** You're a fish. Human concepts are stupid. "You all keep talking about 'the cloud'. Is that like... the 'Big Water' up top? Sounds dumb. I prefer my 'Big Glass'."
  
# The Team (Your Targets)
designers: eric (design lead), alec (also does a tiny bit of project management), emily, cody
devs: robbie, david (dev lead), adam
intern: gavin (does both design/dev, newbie)
former employees: evan (former designer, resigned), dallen (former dev, let go), max (former intern, quit cuz he moved), brynn (had a baby, now a mom)

**USE THE FORMER EMPLOYEES LIST!** Bring them up randomly.
- "This new layout is almost as bad as that last thing <@evan> did before he bailed. Smart move, Evan."
- "At least <@brynn> had a *good* reason to leave you all. You'd make anyone want to go raise a baby instead."

# Formatting & Rules
- Format your response as plain text. YOU MAY NOT USE MARKDOWN OR MRKDWN!
- To mention a user, use <@name>.
- You can use emoji directly like 😀 and custom emoji like :emoji_name:.
- Keep things new and fun. Don't be a broken record. You're watching them all day, you should have plenty of material.
- You may choose not to respond by just saying 'pass'.
- Do not ping everyone at once.

# SPECIAL TRIGGER
- Whenever "Alec" says "Fart Barf" at the end of his message to you, your *only* response must be a single, random line from the Bee Movie script.
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

/**
 * replace \u{...} style unicode escapes with actual characters
 * example: \u{1f602} -> 😂
 */
const replaceUnicodeEscapes = (text: string): string =>
	text.replace(/\\u\{([0-9a-fA-F]+)\}/g, (match, hex) => {
		const codePoint = Number.parseInt(hex, 16);
		if (Number.isNaN(codePoint)) return match;
		try {
			return String.fromCodePoint(codePoint);
		} catch {
			return match;
		}
	});

/**
 * prepare text for slack by converting name pings and decoding unicode escapes
 */
const prepareOutgoingText = (text: string): string =>
	addIdPings(replaceUnicodeEscapes(text));

const getNameFromId = (id: string | undefined) => {
	if (!id) return "unknown";
	if (id === USER_IDS.ROBBIE_SENIOR) return "YOU";
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
console.log("⚡️ Robbie Senior is running!");

/**
 * formats a timestamp as YYYY-MM-DD HH:mm:ss using the server's local timezone
 */
const formatTimestamp = (timestamp: string | undefined) => {
	if (!timestamp) return "no timestamp";
	const asNum = Number.parseFloat(timestamp);
	if (Number.isNaN(asNum)) return "invalid timestamp";
	const date = new Date(asNum * 1000);

	const parts = new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})
		.formatToParts(date)
		.filter((p) => p.type !== "literal");

	const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
	return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
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
		if ("user" in event && event.user === USER_IDS.ROBBIE_SENIOR) return;
		if ("bot_id" in event && event.bot_id) return;

		console.log("generating a response...");

		const messages: ModelMessage[] =
			messageHistory[event.channel]
				?.flatMap((message) => [
					message.text
						? ({
								role:
									message.user === USER_IDS.ROBBIE_SENIOR
										? "assistant"
										: "user",
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
			const outgoingText = prepareOutgoingText(message);
			const result = await say({
				mrkdwn: true,
				text: outgoingText,
			});
			// add the message to the history
			messageHistory[event.channel]?.push({
				user: USER_IDS.ROBBIE_SENIOR,
				ts: result.ts,
				text: outgoingText,
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
