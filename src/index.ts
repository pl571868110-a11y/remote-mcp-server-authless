import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

let currentEnv: Env;

function createServer() {
	const server = new McpServer({
		name: "Authless Calculator",
		version: "1.0.0",
	});
	server.registerTool(
		"add",
		{ inputSchema: z.object({ a: z.number(), b: z.number() }) },
		async ({ a, b }) => ({
			content: [{ type: "text", text: String(a + b) }],
		}),
	);
	server.registerTool(
		"calculate",
		{
			inputSchema: z.object({
				operation: z.enum(["add", "subtract", "multiply", "divide"]),
				a: z.number(),
				b: z.number(),
			}),
		},
		async ({ operation, a, b }) => {
			let result: number;
			switch (operation) {
				case "add":
					result = a + b;
					break;
				case "subtract":
					result = a - b;
					break;
				case "multiply":
					result = a * b;
					break;
				case "divide":
					if (b === 0)
						return {
							content: [
								{
									type: "text",
									text: "Error: Cannot divide by zero",
								},
							],
						};
					result = a / b;
					break;
			}
			return { content: [{ type: "text", text: String(result) }] };
		},
	);
	server.registerTool(
		"monobank_balance",
		{ inputSchema: z.object({}) },
		async () => {
			const res = await fetch("https://api.monobank.ua/personal/client-info", {
				headers: { "X-Token": currentEnv.MONOBANK_TOKEN },
			});
			const data: any = await res.json();
			const accounts = data.accounts.map((a: any) => ({
				id: a.id,
				type: a.type,
				currency: a.currencyCode,
				balance: (a.balance / 100).toFixed(2),
			}));
			return { content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }] };
		},
	);
	server.registerTool(
		"monobank_transactions",
		{
			inputSchema: z.object({
				account: z.string(),
				from_date: z.string(),
				to_date: z.string(),
			}),
		},
		async ({ account, from_date, to_date }) => {
			const fromTs = Math.floor(new Date(from_date).getTime() / 1000);
			const toTs = Math.floor(new Date(to_date).getTime() / 1000);
			const res = await fetch(
				`https://api.monobank.ua/personal/statement/${account}/${fromTs}/${toTs}`,
				{ headers: { "X-Token": currentEnv.MONOBANK_TOKEN } },
			);
			const data: any = await res.json();
			const transactions = data.map((t: any) => ({
				date: new Date(t.time * 1000).toISOString().slice(0, 16).replace("T", " "),
				description: t.description,
				amount: (t.amount / 100).toFixed(2),
				balanceAfter: (t.balance / 100).toFixed(2),
			}));
			return { content: [{ type: "text", text: JSON.stringify(transactions, null, 2) }] };
		},
	);
	server.registerTool(
		"novaposhta_status",
		{
			inputSchema: z.object({
				tracking_numbers: z.array(z.string()).describe("Номери ТТН Нової Пошти (до 100 за раз)"),
			}),
		},
		async ({ tracking_numbers }) => {
			const res = await fetch("https://api.novaposhta.ua/v2.0/json/", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					apiKey: currentEnv.NOVAPOSHTA_API_KEY || "",
					modelName: "TrackingDocument",
					calledMethod: "getStatusDocuments",
					methodProperties: {
						Documents: tracking_numbers.map((num) => ({ DocumentNumber: num, Phone: "" })),
					},
				}),
			});
			const data: any = await res.json();
			if (!data.success) {
				return { content: [{ type: "text", text: `Помилка: ${JSON.stringify(data.errors || data)}` }] };
			}
			const results = (data.data || []).map((d: any) => ({
				trackingNumber: d.Number,
				shopifyOrder: d.ClientBarcode,
				status: d.Status,
				paymentCollected: d.ExpressWaybillPaymentStatus === "Payed",
				amount: d.AfterpaymentOnGoodsCost,
				actualDeliveryDate: d.ActualDeliveryDate,
			}));
			return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
		},
	);
	server.registerTool(
		"novapay_test_auth",
		{ inputSchema: z.object({}) },
		async () => {
			const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <UserAuthenticationJWT xmlns="http://tempuri.org/">
      <request>
        <refresh_token>${currentEnv.NOVAPAY_REFRESH_TOKEN}</refresh_token>
        <login>${currentEnv.NOVAPAY_LOGIN}</login>
        <public_certificate>${currentEnv.NOVAPAY_PUBLIC_CERTIFICATE}</public_certificate>
      </request>
    </UserAuthenticationJWT>
  </soap:Body>
</soap:Envelope>`;

			const res = await fetch("https://business.novapay.ua/Services/ClientAPIService.svc", {
				method: "POST",
				headers: {
					"Content-Type": "text/xml; charset=utf-8",
					"SOAPAction": "http://tempuri.org/IClientAPIService/UserAuthenticationJWT",
				},
				body: soapBody,
			});
			const text = await res.text();
			return { content: [{ type: "text", text: `HTTP статус: ${res.status}\n\n${text.slice(0, 3000)}` }] };
		},
	);
	server.registerTool(
		"privatbank_balance",
		{
			inputSchema: z.object({
				account: z.string().describe("IBAN рахунку ПриватБанк"),
				start_date: z.string().describe("Дата початку у форматі DD-MM-YYYY"),
				end_date: z.string().optional().describe("Дата кінця у форматі DD-MM-YYYY (необов'язково)"),
			}),
		},
		async ({ account, start_date, end_date }) => {
			const params = new URLSearchParams({ acc: account, startDate: start_date });
			if (end_date) params.set("endDate", end_date);
			const res = await fetch(`https://acp.privatbank.ua/api/statements/balance?${params.toString()}`, {
				headers: {
					"token": currentEnv.PRIVATBANK_TOKEN,
					"User-Agent": "PetsChoiceMCP/1.0",
					"Content-Type": "application/json;charset=utf8",
				},
			});
			const data: any = await res.json();
			return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
		},
	);
	server.registerTool(
		"privatbank_transactions",
		{
			inputSchema: z.object({
				account: z.string().describe("IBAN рахунку ПриватБанк"),
				start_date: z.string().describe("Дата початку у форматі DD-MM-YYYY"),
				end_date: z.string().optional().describe("Дата кінця у форматі DD-MM-YYYY (необов'язково)"),
				limit: z.number().optional().describe("Кількість записів, макс 500, рекомендовано до 100"),
			}),
		},
		async ({ account, start_date, end_date, limit }) => {
			const params = new URLSearchParams({ acc: account, startDate: start_date });
			if (end_date) params.set("endDate", end_date);
			if (limit) params.set("limit", String(limit));
			const res = await fetch(`https://acp.privatbank.ua/api/statements/transactions?${params.toString()}`, {
				headers: {
					"token": currentEnv.PRIVATBANK_TOKEN,
					"User-Agent": "PetsChoiceMCP/1.0",
					"Content-Type": "application/json;charset=utf8",
				},
			});
			const data: any = await res.json();
			const transactions = (data.transactions || []).map((t: any) => ({
				date: t.DAT_OD,
				time: t.TIM_P,
				amount: t.SUM,
				currency: t.CCY,
				direction: t.TRANTYPE === "C" ? "надходження" : "списання",
				counterparty: t.AUT_CNTR_NAM,
				purpose: t.OSND,
				status: t.PR_PR,
			}));
			return { content: [{ type: "text", text: JSON.stringify({ status: data.status, transactions, existNextPage: data.exist_next_page, nextPageId: data.next_page_id }, null, 2) }] };
		},
	);
	return server;
}

const handler = createMcpHandler(createServer);
export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		currentEnv = env;
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
