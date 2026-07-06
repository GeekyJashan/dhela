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
          created_at: string
          created_by: string
          gstin: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          gstin?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          gstin?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          aliases: string[] | null
          brand: string | null
          category: string | null
          created_at: string
          gst_rate: number | null
          hsn: string | null
          id: string
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
          gst_rate?: number | null
          hsn?: string | null
          id?: string
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
          gst_rate?: number | null
          hsn?: string | null
          id?: string
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
    },
  },
} as const
