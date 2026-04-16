import tauriHttpClient from './tauriHttpClient';
import { DEVICE_TOKEN_KEY } from './deviceRegisterService';

const ORDER_SERVER_URL = 'https://plexpdf-test.wenxstudio.ai';
const ORDER_ID_KEY = 'plexpdf_last_order_id';

type OrderPlan = 'year' | 'buyout';

interface CreateOrderResponse {
  code: number;
  message: string;
  data: {
    order_id: string;
    url: string;
  };
}

interface OrderStatusResponse {
  code: number;
  message: string;
  data: {
    order_id: number | string;
    paid: boolean;
    status: string;
    status_formatted: string;
  };
}

export interface CreatedOrder {
  orderId: string;
  checkoutUrl: string;
}

export interface OrderStatus {
  orderId: string;
  paid: boolean;
  status: string;
  statusFormatted: string;
}

class OrderService {
  async createOrder(plan: OrderPlan): Promise<CreatedOrder> {
    const token = this.getDeviceToken();
    if (!token) {
      throw new Error('device_token is missing. Please register device first.');
    }

    const baseUrl = ORDER_SERVER_URL.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/client/order/create`;

    const payload = { plan };
    console.log('[OrderService] Creating order:', { endpoint, payload });

    const response = await tauriHttpClient.post<CreateOrderResponse>(
      endpoint,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        responseType: 'json',
        timeout: 30000,
      }
    );

    const json = response.data;
    console.log('[OrderService] Raw create-order response:', JSON.stringify(json, null, 2));

    if (json.code !== 0) {
      throw new Error(`Create order failed: ${json.message}`);
    }

    const orderId = json.data.order_id;
    const checkoutUrl = json.data.url;

    this.saveLastOrderId(orderId);

    return { orderId, checkoutUrl };
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus> {
    const token = this.getDeviceToken();
    if (!token) {
      throw new Error('device_token is missing. Please register device first.');
    }

    const baseUrl = ORDER_SERVER_URL.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/client/order/${encodeURIComponent(orderId)}`;

    const response = await tauriHttpClient.get<OrderStatusResponse>(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: 'json',
      timeout: 30000,
    });

    const json = response.data;
    console.log('[OrderService] Raw order-status response:', JSON.stringify(json, null, 2));

    if (json.code !== 0) {
      throw new Error(`Get order status failed: ${json.message}`);
    }

    return {
      orderId: String(json.data.order_id),
      paid: Boolean(json.data.paid),
      status: json.data.status || '',
      statusFormatted: json.data.status_formatted || json.data.status || 'Processing payment...',
    };
  }

  getLastOrderId(): string | null {
    try {
      return localStorage.getItem(ORDER_ID_KEY);
    } catch {
      return null;
    }
  }

  saveLastOrderId(orderId: string): void {
    try {
      localStorage.setItem(ORDER_ID_KEY, orderId);
    } catch {
      // ignore
    }
  }

  clearLastOrderId(): void {
    try {
      localStorage.removeItem(ORDER_ID_KEY);
    } catch {
      // ignore
    }
  }

  private getDeviceToken(): string | null {
    try {
      return localStorage.getItem(DEVICE_TOKEN_KEY);
    } catch {
      return null;
    }
  }
}

export const orderService = new OrderService();
