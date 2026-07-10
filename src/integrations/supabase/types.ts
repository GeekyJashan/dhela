export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          org_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          org_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          org_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hsn_codes: {
        Row: {
          category: string | null
          code: string
          description: string
          gst_rate: number
          search_tsv: unknown
        }
        Insert: {
          category?: string | null
          code: string
          description: string
          gst_rate: number
          search_tsv?: unknown
        }
        Update: {
          category?: string | null
          code?: string
          description?: string
          gst_rate?: number
          search_tsv?: unknown
        }
        Relationships: []
      }
      invoice_lines: {
        Row: {
          batch: string | null
          created_at: string
          discount_pct: number | null
          expiry_date: string | null
          field_confidence: Json | null
          free_quantity: number | null
          gst_rate: number | null
          hsn: string | null
          id: string
          invoice_id: string
          line_no: number | null
          line_total: number | null
          match_confidence: number | null
          matched_product_id: string | null
          mfg_date: string | null
          mrp: number | null
          needs_review: boolean | null
          org_id: string
          quantity: number | null
          rate: number | null
          raw_description: string | null
          tax_amount: number | null
          taxable_value: number | null
          unit: string | null
        }
        Insert: {
          batch?: string | null
          created_at?: string
          discount_pct?: number | null
          expiry_date?: string | null
          field_confidence?: Json | null
          free_quantity?: number | null
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          invoice_id: string
          line_no?: number | null
          line_total?: number | null
          match_confidence?: number | null
          matched_product_id?: string | null
          mfg_date?: string | null
          mrp?: number | null
          needs_review?: boolean | null
          org_id: string
          quantity?: number | null
          rate?: number | null
          raw_description?: string | null
          tax_amount?: number | null
          taxable_value?: number | null
          unit?: string | null
        }
        Update: {
          batch?: string | null
          created_at?: string
          discount_pct?: number | null
          expiry_date?: string | null
          field_confidence?: Json | null
          free_quantity?: number | null
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          invoice_id?: string
          line_no?: number | null
          line_total?: number | null
          match_confidence?: number | null
          matched_product_id?: string | null
          mfg_date?: string | null
          mrp?: number | null
          needs_review?: boolean | null
          org_id?: string
          quantity?: number | null
          rate?: number | null
          raw_description?: string | null
          tax_amount?: number | null
          taxable_value?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_matched_product_id_fkey"
            columns: ["matched_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          confidence: number | null
          created_at: string
          error_message: string | null
          grand_total: number | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          mime_type: string | null
          org_id: string
          raw_extraction: Json | null
          status: Database["public"]["Enums"]["invoice_status"]
          storage_path: string
          subtotal: number | null
          supplier_gstin: string | null
          supplier_id: string | null
          supplier_name: string | null
          tax_total: number | null
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          grand_total?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          mime_type?: string | null
          org_id: string
          raw_extraction?: Json | null
          status?: Database["public"]["Enums"]["invoice_status"]
          storage_path: string
          subtotal?: number | null
          supplier_gstin?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          tax_total?: number | null
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number | null
          created_at?: string
          error_message?: string | null
          grand_total?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          mime_type?: string | null
          org_id?: string
          raw_extraction?: Json | null
          status?: Database["public"]["Enums"]["invoice_status"]
          storage_path?: string
          subtotal?: number | null
          supplier_gstin?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          tax_total?: number | null
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string
          created_by: string
          default_margin_pct: number | null
          email: string | null
          gstin: string | null
          id: string
          name: string
          phone: string | null
          state_code: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by: string
          default_margin_pct?: number | null
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          state_code?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string
          default_margin_pct?: number | null
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          state_code?: string | null
        }
        Relationships: []
      }
      product_price_overrides: {
        Row: {
          created_at: string
          discount_pct: number | null
          effective_from: string | null
          effective_to: string | null
          id: string
          notes: string | null
          org_id: string
          product_id: string
          retailer_id: string | null
          selling_rate: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          discount_pct?: number | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          notes?: string | null
          org_id: string
          product_id: string
          retailer_id?: string | null
          selling_rate: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          discount_pct?: number | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          product_id?: string
          retailer_id?: string | null
          selling_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_price_overrides_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_overrides_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          aliases: string[] | null
          brand: string | null
          category: string | null
          created_at: string
          current_stock: number | null
          default_margin_pct: number | null
          gst_rate: number | null
          hsn: string | null
          id: string
          last_purchase_rate: number | null
          mrp: number | null
          name: string
          org_id: string
          pack_size: string | null
          purchase_rate: number | null
          selling_rate: number | null
          sku: string | null
          unit: string | null
        }
        Insert: {
          aliases?: string[] | null
          brand?: string | null
          category?: string | null
          created_at?: string
          current_stock?: number | null
          default_margin_pct?: number | null
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          last_purchase_rate?: number | null
          mrp?: number | null
          name: string
          org_id: string
          pack_size?: string | null
          purchase_rate?: number | null
          selling_rate?: number | null
          sku?: string | null
          unit?: string | null
        }
        Update: {
          aliases?: string[] | null
          brand?: string | null
          category?: string | null
          created_at?: string
          current_stock?: number | null
          default_margin_pct?: number | null
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          last_purchase_rate?: number | null
          mrp?: number | null
          name?: string
          org_id?: string
          pack_size?: string | null
          purchase_rate?: number | null
          selling_rate?: number | null
          sku?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retailers: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          created_by: string | null
          credit_limit: number | null
          default_discount_pct: number | null
          email: string | null
          gstin: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          outstanding_balance: number | null
          phone: string | null
          pincode: string | null
          price_tier: string | null
          state_code: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          default_discount_pct?: number | null
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          outstanding_balance?: number | null
          phone?: string | null
          pincode?: string | null
          price_tier?: string | null
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          default_discount_pct?: number | null
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          outstanding_balance?: number | null
          phone?: string | null
          pincode?: string | null
          price_tier?: string | null
          state_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retailers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_lines: {
        Row: {
          batch: string | null
          cgst_amount: number | null
          cost_price: number | null
          created_at: string
          description: string
          discount_amount: number | null
          discount_pct: number | null
          expiry_date: string | null
          free_quantity: number | null
          gst_rate: number | null
          hsn: string | null
          id: string
          igst_amount: number | null
          line_no: number | null
          line_total: number | null
          mrp: number | null
          org_id: string
          product_id: string | null
          profit: number | null
          quantity: number
          rate: number
          sales_invoice_id: string
          sgst_amount: number | null
          tax_amount: number | null
          taxable_value: number | null
          unit: string | null
        }
        Insert: {
          batch?: string | null
          cgst_amount?: number | null
          cost_price?: number | null
          created_at?: string
          description: string
          discount_amount?: number | null
          discount_pct?: number | null
          expiry_date?: string | null
          free_quantity?: number | null
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          igst_amount?: number | null
          line_no?: number | null
          line_total?: number | null
          mrp?: number | null
          org_id: string
          product_id?: string | null
          profit?: number | null
          quantity?: number
          rate?: number
          sales_invoice_id: string
          sgst_amount?: number | null
          tax_amount?: number | null
          taxable_value?: number | null
          unit?: string | null
        }
        Update: {
          batch?: string | null
          cgst_amount?: number | null
          cost_price?: number | null
          created_at?: string
          description?: string
          discount_amount?: number | null
          discount_pct?: number | null
          expiry_date?: string | null
          free_quantity?: number | null
          gst_rate?: number | null
          hsn?: string | null
          id?: string
          igst_amount?: number | null
          line_no?: number | null
          line_total?: number | null
          mrp?: number | null
          org_id?: string
          product_id?: string | null
          profit?: number | null
          quantity?: number
          rate?: number
          sales_invoice_id?: string
          sgst_amount?: number | null
          tax_amount?: number | null
          taxable_value?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          amount_paid: number | null
          cgst_total: number | null
          created_at: string
          created_by: string | null
          discount_total: number | null
          due_date: string | null
          grand_total: number | null
          id: string
          igst_total: number | null
          invoice_date: string
          invoice_number: string
          is_interstate: boolean | null
          notes: string | null
          org_id: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          place_of_supply: string | null
          retailer_id: string
          round_off: number | null
          sgst_total: number | null
          status: Database["public"]["Enums"]["sales_invoice_status"]
          subtotal: number | null
          tax_total: number | null
          total_cost: number | null
          total_profit: number | null
          updated_at: string
        }
        Insert: {
          amount_paid?: number | null
          cgst_total?: number | null
          created_at?: string
          created_by?: string | null
          discount_total?: number | null
          due_date?: string | null
          grand_total?: number | null
          id?: string
          igst_total?: number | null
          invoice_date?: string
          invoice_number: string
          is_interstate?: boolean | null
          notes?: string | null
          org_id: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          place_of_supply?: string | null
          retailer_id: string
          round_off?: number | null
          sgst_total?: number | null
          status?: Database["public"]["Enums"]["sales_invoice_status"]
          subtotal?: number | null
          tax_total?: number | null
          total_cost?: number | null
          total_profit?: number | null
          updated_at?: string
        }
        Update: {
          amount_paid?: number | null
          cgst_total?: number | null
          created_at?: string
          created_by?: string | null
          discount_total?: number | null
          due_date?: string | null
          grand_total?: number | null
          id?: string
          igst_total?: number | null
          invoice_date?: string
          invoice_number?: string
          is_interstate?: boolean | null
          notes?: string | null
          org_id?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          place_of_supply?: string | null
          retailer_id?: string
          round_off?: number | null
          sgst_total?: number | null
          status?: Database["public"]["Enums"]["sales_invoice_status"]
          subtotal?: number | null
          tax_total?: number | null
          total_cost?: number | null
          total_profit?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          code: string | null
          contact: string | null
          created_at: string
          gstin: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          address?: string | null
          code?: string | null
          contact?: string | null
          created_at?: string
          gstin?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          address?: string | null
          code?: string | null
          contact?: string | null
          created_at?: string
          gstin?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_org_role: {
        Args: { _org: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      next_sales_invoice_number: { Args: { _org: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "operator" | "accountant"
      invoice_status:
        | "uploaded"
        | "processing"
        | "review"
        | "approved"
        | "rejected"
        | "failed"
      payment_status: "unpaid" | "partial" | "paid"
      sales_invoice_status: "draft" | "issued" | "paid" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator", "accountant"],
      invoice_status: [
        "uploaded",
        "processing",
        "review",
        "approved",
        "rejected",
        "failed",
      ],
      payment_status: ["unpaid", "partial", "paid"],
      sales_invoice_status: ["draft", "issued", "paid", "cancelled"],
    },
  },
} as const
