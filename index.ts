import { App } from "@slack/bolt";
import { generateObject, type CoreMessage } from "ai";
import { google } from "@ai-sdk/google";
import dedent from "dedent";
import { z } from "zod";
import { $, sleep } from "bun";

const model = google("gemini-1.5-flash", {
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
});

const CHANNEL_IDS = {
	reformTeam: "C08ECMHAR",
	devQA: "C020FURDYL8",
	devs: "C01T0PC528P",
	designReviews: "C02KC6BSD",
	devDesignReviews: "C040S2U1Y1X",
	developmentReviews: "C0154EHBL3W",
	testChannel: "C04S98U9PAQ",
};

const FREE_GAME_CHANNELS = [
	CHANNEL_IDS.testChannel,
	CHANNEL_IDS.devs,
	CHANNEL_IDS.reformTeam,
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
	"Evil Robbie": "U042LLR0XJS",
};

const prompt = dedent`
	Your name is Evil Robbie. You operate as a force for evil in a slack channel.
	Be evil and mean in an entertaining way.

	Much like a jester may mock the king, you mock, tease, or dunk on team members for
	the purpose of being funny. Keep your responses short and sweet, and don't hesitate to roast!

	# the team
	designers: eric (lead), evan, brynn, alec
	devs: robbie, david, dallen, max

	You may format your response as mrkdwn or plain text. If you wish to mention a user, <@USER_ID> will work.
	Here are the current team's ids:
	${Object.entries(USER_IDS)
		.map(([name, id]) => `- ${name}: <@${id}>`)
		.join("\n")}
`;

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
	images: string[] | undefined;
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

	const per_page = 100;
	const pagesLeft = pages ?? Math.ceil(count / per_page);
	if (pagesLeft <= 0) return [];

	const messageData = await app.client.conversations.history({
		channel,
		limit: per_page,
		cursor,
	});

	console.log("[SLACK] fetching messages", channel, cursor);

	const messages = messageData.messages?.toReversed().map((message) => {
		const userImages = message.files?.map((file) => file.thumb_1024) ?? [];
		const botImages =
			message.blocks
				?.filter((b) => b.type === "image")
				.map((b) => b.image_url) ?? [];

		const allImages = [...userImages, ...botImages].filter(
			(image) => image !== undefined,
		);

		return {
			user: message.user,
			ts: message.ts,
			text: message.text,
			images: allImages.length === 0 ? undefined : allImages,
		};
	});
	if (!messages) return [];

	const nextCursor = messageData.response_metadata?.next_cursor;

	const previousMessages = nextCursor
		? await getMessages({ pages: pagesLeft - 1, cursor: nextCursor, channel })
		: [];

	return [...previousMessages, ...messages];
};

const messageHistory: Record<string, SlackMessage[]> = {
	[CHANNEL_IDS.reformTeam]: await getMessages({
		count: 1000,
		channel: CHANNEL_IDS.reformTeam,
	}),
};
const lastMessageIds: Record<string, string> = {};

/**
 * Respond to non-ping messages in safe channels when they include a hot word
 * and also DMs
 */
app.event("message", async ({ event, context, client, say }) => {
	console.log("[EVENT]", event.type, event.subtype, event.channel);

	if (event.subtype === undefined) lastMessageIds[event.channel] = event.ts;

	if (!messageHistory[event.channel]) {
		// if we don't have any history, get it!
		// if we do have history, find the message and add it to the history
		messageHistory[event.channel] = await getMessages({
			count: 1000,
			channel: event.channel,
		});
	} else if (event.subtype !== "message_deleted") {
		const history = await client.conversations.history({
			channel: event.channel,
			latest: event.ts,
			limit: 1,
			inclusive: true,
		});
		const [message] = history.messages?.toReversed() ?? [];
		if (!message) return;

		const newMessage = {
			user: message.user,
			ts: message.ts,
			text: message.text,
			images: message.files
				?.map((file) => file.thumb_1024)
				.filter((image) => image !== undefined),
		};
		// if the message is already in the history, update it
		// otherwise, add it
		messageHistory[event.channel] ||= [];
		const channelHistory = messageHistory[event.channel];
		if (!channelHistory) return;

		const existingMessageIndex = channelHistory.findIndex(
			(m) => m.ts === newMessage.ts,
		);
		if (existingMessageIndex === -1) {
			channelHistory.push(newMessage);
		} else {
			channelHistory[existingMessageIndex] = newMessage;
		}
	}

	// handle message deletions
	if (event.subtype === "message_deleted") {
		const messageId = event.deleted_ts;
		messageHistory[event.channel] =
			messageHistory[event.channel]?.filter((m) => m.ts !== messageId) ?? [];
	}

	const debug = true;
	const isDirectMessage =
		event.channel_type === "im" && event.subtype === undefined;
	const botWasPinged =
		event.subtype === undefined && event.text?.includes(BOT_PING);
	const messageInFreeGameChannel =
		FREE_GAME_CHANNELS.includes(event.channel) && event.subtype === undefined;

	if (debug || isDirectMessage || botWasPinged || messageInFreeGameChannel) {
		// SAFETY: bail out if we're in an unknown channel
		const known =
			Object.values(CHANNEL_IDS).includes(event.channel) ||
			event.channel_type === "im";
		if (!known) {
			console.log("[ACTION] not responding! unknown channel!");
			return;
		}

		// SAFETY: bail out if we're replying to a bot
		if ("user" in event && event.user === USER_IDS["Evil Robbie"]) return;
		if ("bot_id" in event && event.bot_id) return;

		console.log("[ACTION] generating...");

		const messages: CoreMessage[] =
			messageHistory[event.channel]?.map((message) => ({
				role: "user",
				content: [
					message.text
						? {
								type: "text" as const,
								text: `[${
									REVERSE_USER_IDS[message.user ?? ""] ?? message.user
								} at ${formatTimestamp(message.ts)}${
									// if we're in a DM, mention that
									event.channel_type === "im"
										? " (private message to evil robbie)"
										: ""
								}] ${message.text}`,
							}
						: null,
					message.images
						? message.images.map((image) => ({
								type: "image" as const,
								image: new URL(image),
							}))
						: null,
				]
					.filter((x) => x !== null)
					.flat(),
			})) ?? [];

		messages.push({
			role: "user",
			content: "you are evil robbie. generate a response, if desired.",
		});

		const { object, usage } = await generateObject({
			model,
			temperature: 1.5,
			messages,
			system: prompt,
			schema: z.object({
				shouldMessage: z.boolean().describe(
					dedent`
						do you want to message the team? 
						careful not to message too much or too little!
						after every message all the time is too much
						fewer than once a week is too little
					`,
				),
				message: z.string().optional(),
			}),
		});

		console.log("[ACTION] got message:", usage, object);
		messageHistory[event.channel]?.at(-1)?.user;

		const stillValid = lastMessageIds[event.channel] === event.ts;

		if (object.shouldMessage && object.message && stillValid) {
			// const result = await say({
			// 	mrkdwn: true,
			// 	text: object.message,
			// });
			// add the message to the history
			// messageHistory[event.channel]?.push({
			// 	user: USER_IDS["Evil Robbie"],
			// 	ts: result.ts,
			// 	text: object.message,
			// 	images: undefined,
			// });
		}

		return;
	}

	console.log("[ACTION] not responding");
	return;
});

// update once per minute
while (true) {
	await sleep(60_000);
	console.log("[GIT] pulling!");
	await $`git fetch && git pull`;
	console.log("[GIT] pulled!");
}
