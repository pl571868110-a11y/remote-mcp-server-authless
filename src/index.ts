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
	return server;
}

const handler = createMcpHandler(createServer);
export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		currentEnv = env;
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
