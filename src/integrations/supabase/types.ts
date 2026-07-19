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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      assistant_messages: {
        Row: {
          answer: string
          created_at: string
          id: string
          org_id: string
          question: string
          user_id: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          org_id: string
          question: string
          user_id: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          org_id?: string
          question?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      credit_note_lines: {
        Row: {
          created_at: string
          credit_note_id: string
          description: string
          discount_pct: number
          gst_rate: number
          hsn: string | null
          id: string
          line_total: number
          org_id: string
          product_id: string | null
          quantity: number
          rate: number
          tax_amount: number
          taxable_value: number
        }
        Insert: {
          created_at?: string
          credit_note_id: string
          description: string
          discount_pct?: number
          gst_rate?: number
          hsn?: string | null
          id?: string
          line_total?: number
          org_id: string
          product_id?: string | null
          quantity: number
          rate?: number
          tax_amount?: number
          taxable_value?: number
        }
        Update: {
          created_at?: string
          credit_note_id?: string
          description?: string
          discount_pct?: number
          gst_rate?: number
          hsn?: string | null
          id?: string
          line_total?: number
          org_id?: string
          product_id?: string | null
          quantity?: number
          rate?: number
          tax_amount?: number
          taxable_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_lines_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          created_at: string
          created_by: string | null
          credit_date: string
          credit_note_number: string
          grand_total: number
          id: string
          notes: string | null
          org_id: string
          reason: string
          restock: boolean
          retailer_id: string
          sales_invoice_id: string | null
          subtotal: number
          tax_total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credit_date?: string
          credit_note_number: string
          grand_total?: number
          id?: string
          notes?: string | null
          org_id: string
          reason?: string
          restock?: boolean
          retailer_id: string
          sales_invoice_id?: string | null
          subtotal?: number
          tax_total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credit_date?: string
          credit_note_number?: string
          grand_total?: number
          id?: string
          notes?: string | null
          org_id?: string
          reason?: string
          restock?: boolean
          retailer_id?: string
          sales_invoice_id?: string | null
          subtotal?: number
          tax_total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      gstin_cache: {
        Row: {
          fetched_at: string
          filer_rating: string | null
          gstin: string
          legal_name: string | null
          raw: Json | null
          status: string | null
          trade_name: string | null
        }
        Insert: {
          fetched_at?: string
          filer_rating?: string | null
          gstin: string
          legal_name?: string | null
          raw?: Json | null
          status?: string | null
          trade_name?: string | null
        }
        Update: {
          fetched_at?: string
          filer_rating?: string | null
          gstin?: string
          legal_name?: string | null
          raw?: Json | null
          status?: string | null
          trade_name?: string | null
        }
        Relationships: []
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
          extraction_engine: string | null
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
          extraction_engine?: string | null
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
          extraction_engine?: string | null
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
      order_lines: {
        Row: {
          created_at: string
          fulfilled_quantity: number
          id: string
          order_id: string
          org_id: string
          product_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          fulfilled_quantity?: number
          id?: string
          order_id: string
          org_id: string
          product_id: string
          quantity: number
        }
        Update: {
          created_at?: string
          fulfilled_quantity?: number
          id?: string
          order_id?: string
          org_id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          org_id: string
          retailer_id: string
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number: string
          org_id: string
          retailer_id: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string
          org_id?: string
          retailer_id?: string
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_ifsc: string | null
          bank_name: string | null
          created_at: string
          created_by: string
          default_margin_pct: number | null
          email: string | null
          gstin: string | null
          id: string
          name: string
          phone: string | null
          plan: string
          plan_valid_till: string | null
          signatory_name: string | null
          signature_image: string | null
          state_code: string | null
          upi_id: string | null
        }
        Insert: {
          address?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          created_at?: string
          created_by: string
          default_margin_pct?: number | null
          email?: string | null
          gstin?: string | null
          id?: string
          name: string
          phone?: string | null
          plan?: string
          plan_valid_till?: string | null
          signatory_name?: string | null
          signature_image?: string | null
          state_code?: string | null
          upi_id?: string | null
        }
        Update: {
          address?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          created_at?: string
          created_by?: string
          default_margin_pct?: number | null
          email?: string | null
          gstin?: string | null
          id?: string
          name?: string
          phone?: string | null
          plan?: string
          plan_valid_till?: string | null
          signatory_name?: string | null
          signature_image?: string | null
          state_code?: string | null
          upi_id?: string | null
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          amount: number
          created_at: string
          id: string
          org_id: string
          payment_id: string
          purchase_invoice_id: string | null
          sales_invoice_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          org_id: string
          payment_id: string
          purchase_invoice_id?: string | null
          sales_invoice_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          org_id?: string
          payment_id?: string
          purchase_invoice_id?: string | null
          sales_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          discount_amount: number
          id: string
          mode: Database["public"]["Enums"]["payment_mode"]
          notes: string | null
          org_id: string
          party_type: string
          payment_date: string
          reference: string | null
          retailer_id: string | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          id?: string
          mode?: Database["public"]["Enums"]["payment_mode"]
          notes?: string | null
          org_id: string
          party_type: string
          payment_date?: string
          reference?: string | null
          retailer_id?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          id?: string
          mode?: Database["public"]["Enums"]["payment_mode"]
          notes?: string | null
          org_id?: string
          party_type?: string
          payment_date?: string
          reference?: string | null
          retailer_id?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
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
          stock_group_id: string | null
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
          stock_group_id?: string | null
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
          stock_group_id?: string | null
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
          {
            foreignKeyName: "products_stock_group_id_fkey"
            columns: ["stock_group_id"]
            isOneToOne: false
            referencedRelation: "stock_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      retailers: {
        Row: {
          address: string | null
          category: string
          city: string | null
          created_at: string
          created_by: string | null
          credit_limit: number | null
          default_discount_pct: number | null
          email: string | null
          gst_filer_rating: string | null
          gst_status: string | null
          gstin: string | null
          id: string
          name: string
          notes: string | null
          opening_balance: number
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
          category?: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          default_discount_pct?: number | null
          email?: string | null
          gst_filer_rating?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          name: string
          notes?: string | null
          opening_balance?: number
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
          category?: string
          city?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          default_discount_pct?: number | null
          email?: string | null
          gst_filer_rating?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          name?: string
          notes?: string | null
          opening_balance?: number
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
          order_id: string | null
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
          order_id?: string | null
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
          order_id?: string | null
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
            foreignKeyName: "sales_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
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
      stock_groups: {
        Row: {
          created_at: string
          discount_a: number
          discount_b: number
          discount_c: number
          hsn_code: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discount_a?: number
          discount_b?: number
          discount_c?: number
          hsn_code?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discount_a?: number
          discount_b?: number
          discount_c?: number
          hsn_code?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_groups_org_id_fkey"
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
          gst_filer_rating: string | null
          gst_status: string | null
          gstin: string | null
          id: string
          name: string
          opening_balance: number
          org_id: string
        }
        Insert: {
          address?: string | null
          code?: string | null
          contact?: string | null
          created_at?: string
          gst_filer_rating?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          name: string
          opening_balance?: number
          org_id: string
        }
        Update: {
          address?: string | null
          code?: string | null
          contact?: string | null
          created_at?: string
          gst_filer_rating?: string | null
          gst_status?: string | null
          gstin?: string | null
          id?: string
          name?: string
          opening_balance?: number
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
      party_balances: {
        Row: {
          balance: number | null
          name: string | null
          org_id: string | null
          party_id: string | null
          party_type: string | null
        }
        Relationships: []
      }
      party_ledger: {
        Row: {
          created_at: string | null
          credit: number | null
          debit: number | null
          kind: string | null
          org_id: string | null
          party_id: string | null
          party_type: string | null
          ref: string | null
          source_id: string | null
          tx_date: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_org_role: {
        Args: { _org: string; _role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      next_credit_note_number: { Args: { _org: string }; Returns: string }
      next_order_number: { Args: { _org: string }; Returns: string }
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
        | "queued"
      order_status: "pending" | "partial" | "fulfilled" | "cancelled"
      payment_mode: "cash" | "upi" | "bank" | "cheque" | "other"
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
  graphql_public: {
    Enums: {},
  },
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
        "queued",
      ],
      order_status: ["pending", "partial", "fulfilled", "cancelled"],
      payment_mode: ["cash", "upi", "bank", "cheque", "other"],
      payment_status: ["unpaid", "partial", "paid"],
      sales_invoice_status: ["draft", "issued", "paid", "cancelled"],
    },
  },
} as const
