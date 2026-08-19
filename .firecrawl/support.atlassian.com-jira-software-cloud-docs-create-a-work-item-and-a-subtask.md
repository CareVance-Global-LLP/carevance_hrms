[Skip to main content](https://support.atlassian.com/jira-software-cloud/docs/create-a-work-item-and-a-subtask/#maincontent)

[Cloud](https://support.atlassian.com/jira-software-cloud)

Data Center

# Create a work item and a subtask

We're rolling out some changes to the work item as an open beta. Some documentation may not yet reflect these updates, and the new experience might not be enabled on your site. [Read more about the upcoming changes](https://community.atlassian.com/forums/Jira-articles/A-clearer-more-focused-Jira-work-item-view-is-coming/ba-p/3262002 "https://community.atlassian.com/forums/Jira-articles/A-clearer-more-focused-Jira-work-item-view-is-coming/ba-p/3262002")

Work items are the building blocks of any space. They describe and contain the work that needs to be done. They travel through workflows within their spaces until the work is complete.

A work item can have subtasks that can be assigned and tracked individually. You can also restrict a work item to certain members of your team.

This page focuses on the different ways you can create work items and subtasks, convert work items, and set work-level security.

For those just getting started, head over to our admin docs to [discover how to configure work types](https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-types/ "https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-types/") or, find out how you can [import multiple work items via a CSV](https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/ "https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/").

You must have the following to do the things described on this page.

**Permission:** Create work items

AI is available and automatically enabled for all apps on Standard, Premium, and Enterprise plans. Organization admins can manage AI preferences by selecting **Rovo**, then **Rovo access** in Atlassian Administration.

AI is not available in [Atlassian Government organizations](https://support.atlassian.com/organization-administration/docs/feature-availability-for-atlassian-government-cloud/). For Sandbox environments, you must [manually activate it](https://support.atlassian.com/organization-administration/docs/test-drive-rovo-with-your-organization/ "https://support.atlassian.com/organization-administration/docs/test-drive-rovo-with-your-organization/").

* * *

## Create a work item

You can create a work item from anywhere in Jira. Select **Create** (+) in the navigation bar at the top of the screen, and a compact dialog opens where you can capture the work and fill in a few key fields.

![An animation of someone selecting create to start creating a work item.](https://images.ctfassets.net/zsv3d0ugroxu/4gwx3avL4RkwQx1Livjpdp/c5df5133d4acc14f9fcc1e4a158c0057/GIF_Jira_Createbutton)

### Quick Create (default)

![An annotated image of Quick Create mode](https://images.ctfassets.net/zsv3d0ugroxu/3Al6Rw0vjsr6vv56TUMCzT/79908842542bf9653654396b7ea11970/screenshot_Jira_quickcreate)

1. Select **Create** ().

1. **Space and work type** in the header, represented by the space icon, space key, and work type name. These default to the space you're currently viewing and the work type you last used in that space.

2. **Title** — Type a title for the work item. This field was previously labelled `Summary`. JQL queries, API calls, and automations that reference `summary` still work as before.

3. **Description** — Add details about the work item. The description field expands vertically to accommodate long descriptions, code blocks, table edits, and pasted images. Use slash commands (`/`) to insert elements or invoke Rovo. A formatting toolbar appears when text is selected.

4. **Required fields** — Up to 3 required fields appear as chips below the description. When there are no required fields, Quick Create shows only the optional fields.

5. **Optional fields** — The next 3 fields in your admin's configuration appear beside the required fields as optional fields. The field order matches your admin's configuration in space settings.
2. Fill in the required fields and any relevant optional fields.

3. Optional: To create more work items with the same **Space** and **Work type,** select the **Create another** checkbox. Depending on your configuration and work item creation history, some fields may be pre-populated. Review these before creating the new work item.

4. When you're finished, select **Create**.


**Tip:** If you click outside the create dialog, it minimizes into a dock at the bottom of your screen rather than closing, so you don't lose your draft. Select the docked item to resume editing in docked mode or expand to full form.

### Full form mode

![The full form used to create a Jira work item](https://images.ctfassets.net/zsv3d0ugroxu/5CjmJ4RUZi0cja4W3ZXs7G/65f2a8fda493a5daedbd6615b0751a8b/screenshot_Jira_FullFormCreate)

If you need access to all fields at creation time, you can expand to the full form.

1. In the create dialog, select the expand icon to switch to full form mode.

2. The dialog expands to show all available fields for your space and work type, similar to the previous full create form.

3. Fill in all relevant fields and select **Create**.


**Setting full form as your default:** When in full form mode, select **More actions (•••)** in the create dialog, then toggle on **Always open in this view**. Future creates will open in full form mode. No admin action needed.

![The settings panel on a work item.](https://images.ctfassets.net/zsv3d0ugroxu/4Rlh11TY7dybFW8yiKZdr8/92df418e2c42fb9d2a4981687ec618e9/screenshot_Jira_workitemcontrols)

The full form opens automatically when your space configuration requires it, for example if your space has more than three required fields, uses custom tabs, custom create screens, Forge UI app modifications, or a complex field type.

### Dock mode

The create dialog supports docking, a minimized state that anchors the dialog to the bottom-right of your screen. This lets you continue working in Jira without losing your draft.

- **Click outside the dialog** to automatically dock it.

- **Select the Dock icon** in the create dialog to manually go to docked mode.


This is helpful when you need to reference other work items or check information mid-creation.

![GIF_Jira_dockmode](https://images.ctfassets.net/zsv3d0ugroxu/5Dw6BK66IIMzHfSyLa6LQl/68a4fdbe22ac15849317734da52f0d6b/ezgif.com-video-to-gif-converter__3_)

### Change which fields appear in Quick Create

1. Select **More actions (** **)** in the create dialog.

2. Select **Configure Fields**.

3. Select **Custom fields** from the dropdown menu, then choose the fields you want to display.


|     |     |
| --- | --- |
| ![The settings panel on a work item](https://images.ctfassets.net/zsv3d0ugroxu/6B2JpO5QqduKDFVWvMCkvL/8415c7b4f27009e46b5dd50fc8edad2e/screenshot_Jira_configurefields) | ![The fields you can configure in a work item](https://images.ctfassets.net/zsv3d0ugroxu/2IkL1065PPq4GxNfOfK8oT/dbf049caf6e73f5870a493c44a989957/screenshot_Jira_fieldoptions) |

This updates the fields for the work item you're currently creating as well as any future work items.

## Other ways to create work items

### Inline create from the Backlog

You can quickly create work items using inline create in the Backlog for Scrum boards, backlog, and future sprints only. Just select **\+ Create**.

If your board's filter specifies more than one space, you'll still need to complete the full create dialog.

When you create work items inline, your work items won't be restricted to certain roles in the space. These work items can be accessed by anyone who can see your space. To restrict work items, create them using the global navigation bar.

### Create from a board

If you create a work item on a board that's using a JQL filter, the work item will inherit fields such as custom values and labels.

### Create using Rovo

Use Rovo to create work items by opening Rovo Chat and entering `/create-work-items`. You can write a quick prompt telling Rovo what needs to be done, or paste a link to a Loom video or a Confluence page. Rovo will suggest work items for you to review, refine, and create once you're happy with them. Some fields may not yet be supported. [Read more about creating work items with Rovo](https://support.atlassian.com/jira-software-cloud/docs/create-work-items-with-rovo/ "https://support.atlassian.com/jira-software-cloud/docs/create-work-items-with-rovo/")

### Create using the command palette

You can perform this action with your keyboard via Jira's command palette. Use **command + K** for Mac or **Ctrl + K** for Windows to open the command palette while you're in Jira.

Other entry points that previously triggered the older create form will now open the new window. For example, when a required field is empty during inline creation in Boards, Timeline, or Roadmap view, or when creating child items, the new create dialog will prompt you to complete the required fields.

The new create experience does not apply yet to Jira Service Management and Jira Product Discovery.

## Where your new work item appears

Your newly created work item will appear at the top of your backlog, unless:

- You've selected a work item in the backlog, in which case your work item will be created right below the selected work item.

- You've specified a sprint when creating the work item, in which case your work item will be created at the bottom of the sprint.


You can also create a work item that automatically belongs to a larger piece of work. If your space uses a work type like an epic or workstream for tracking larger pieces of work, add the **Parent** field via Configure Fields and assign it during creation.

## Find and link similar work items with AI

When you create a new work item, you can use AI to find and link similar, existing work items so you can connect to past work or avoid duplication.

Type in the **Title** field, and Jira will use AI to surface similar work items for you to review. Link the relevant work items before you select **Create**. All linked work items will appear in the Linked work items panel on your new work item.

## For admins: Configure which fields appear in Quick Create

You can control which fields your team members see by default in quick create by ranking fields at the top of the work item field list in Space Setting. Fields ranked higher will appear in quick create for all team members in that space.

![The space settings menu](https://images.ctfassets.net/zsv3d0ugroxu/5RMCmVvVnRtvlrITDgYblb/104a8933d9ad1b58c6815331002504de/screenshot_Jira_spacesettings)

### Company-managed spaces

1. Once inside Space Setting, select the Screen corresponding to create issue and the targeted work type.

2. Reorder the fields so your preferred fields appear at the top. Quick Create always shows Title, Description, and up to three required fields — those are fixed. Beyond those, Jira displays the **next three fields in your list** as the optional fields your team can fill without switching to the full form. So if you want your team to see Priority, Sprint, and Assignee in Quick Create, drag those to the top of the field list.


![The screens settings in Jira](https://images.ctfassets.net/zsv3d0ugroxu/2BFcehBPYlvfbJmTkv9S8F/967c36c01e8576b233825f2e178de5aa/screenshot_Jira_spacesettings_screens)

### Team-managed spaces

1. Once inside **Space Settings**, select **Work types**.

2. Select the work type you want to configure.

3. Reorder the fields to control what your team sees in Quick Create.


![The work type screen in space settings](https://images.ctfassets.net/zsv3d0ugroxu/4UzjVldyZTCRaFDs84RYfw/9d4b38b26f166a5d620727d94806d1fc/screenshot_Jira_worktypes)

Admins of Company Managed Spaces can create a custom screen using [these steps](https://confluence.atlassian.com/adminjiraserver/defining-a-screen-938847288.html "https://confluence.atlassian.com/adminjiraserver/defining-a-screen-938847288.html").

Note, that a custom create screen always opens Full Form by default.

## For admins: Reverting to the previous create experience

Admins can revert their site to the previous create experience via **Settings > System > General Configurations.** Then set **Simple Create as Default** to`off`. This applies to the entire site.

![Jira admin settins with Simple create as default highlighted](https://images.ctfassets.net/zsv3d0ugroxu/1sXgB0cLXEC4PQzUv6v8G5/f51a650c81cd9d83c31ba648897b3ac3/screenshot_Jira_adminsettings_simplecreate)

* * *

* * *

## Split a work item

Splitting work items isn’t available in business spaces.

Splitting a work item is useful when a work item is so big that it's better to divide it into two or more work items and make work more manageable. You can only split a work item from the _Scrum backlog_ or the _Kanban backlog_(if enabled), and not from active sprints or the Kanban board.

1. Navigate to the **Backlog** of your Scrum or Kanban space.

2. Select a work item, then choose **Split work item**.


You'll also find the option to split a work item in the **sprint** or Selected for Development section of your **Backlog**. [Discover more about your Kanban backlog](https://support.atlassian.com/jira-software-cloud/docs/configure-columns/#Configuringcolumns-enablingkanbanbacklog "https://support.atlassian.com/jira-software-cloud/docs/configure-columns/#Configuringcolumns-enablingkanbanbacklog").

### Access the new work item

**From a Scrum backlog**

If you split a work item in the backlog, the new work item will be sent to the Backlog section. If you split a work item in an active sprint, you can choose to send the new work item to either the backlog or a future or active sprint.

**In a Kanban backlog**

After splitting a work item, the new work item will be sent to the Backlogsection. This depends on the column configuration of your Kanban board, but this is essentially the section for the column that's mapped to the initial status of your workflow.

### Edit the new work item

The new work item will be of the same work type as the original. For example, if you split a story into two or more work items, the new ones will also be stories.

**Other details**

- The new work item will have most of the same details stored in the original, including priority, component, label, custom fields. Some details won’t be copied over, including work log, comments, history and links. The original work item will be linked to the new work item.

- If the original work item has estimates, you'll be able to enter estimates for the new one as well. You can also update the estimate of the original as necessary.

- The status also returns to the first step of the corresponding workflow, and the resolutions are cleared.


* * *

## Create a subtask or child work item

Subtasks in company-managed spaces, or child work items in team-managed spaces, allow you to assign different aspects of a work item to different people. You can only create subtasks in company-managed spaces if your administrator has enabled subtasks, and has added the subtask work type to the space's work type scheme.

In most cases, child work items can only be created and nested under standalone work items. In company-managed software spaces, you can assign subtasks directly to the work type your space uses for larger pieces of work (by default, this is called an epic) using the **Add parent** link on the work item.

To create a subtask or child work item:

1. Open the work item you’d like to be the parent.

2. Select **Add or create related work** () under the work item’s summary

1. If you’re in a team-managed space, select **Add a child work item** ()

2. If you are in a company-managed space, select **Create subtask**()
3. Add a summary, then select **Create**.


A subtask will inherit the space, work security level, and sprint value (software spaces) from their parent.

### Change the parent work item of a child work item

To change the parent work item:

1. Open the child work item or subtask.

2. Select the work type icon in the top-left corner next to the key of the parent work item.

3. Select a new parent work item for your child work item or subtask.


In the timeline and list views, you can also change the parent work item of a work item by dragging and dropping it underneath a new parent work item.

You can perform this action with your keyboard via Jira’s command palette. Use **command** \+ **K**(for Mac) or **Ctrl + K** (for Windows) to open the command palette while you’re in Jira. [Read more about Jira’s command palette](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-command-palette/ "https://support.atlassian.com/jira-software-cloud/docs/what-is-the-command-palette/")

You can use AI to generate a list of suggested child work items, based on the details of the parent work item. When you accept a suggestion, a new child work item will be created and linked to the parent work item.

When creating a child work item or subtask, select **Suggest work items**. A list of suggested child work items will generate which you can accept, edit, or decline.

* * *

## Define the work type

### Change a work type

After you create a work item, you may want to change its type to better represent the work. For example, you may want to turn a work item that was raised as a task into a bug. [More on work types](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/ "https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/").

To change the work type:

1. Open the work item you want to update.

2. Select the current work type icon, which is shown next to the work item key, above the summary.

3. Choose a new work type from the drop-down menu.


If there are different fields in the new work type, or if it has a different workflow, we'll open the _move work item_ screen to complete the change.

### Convert a subtask to a work item

In a company-managed space:

1. Navigate to the subtask you want to convert.

2. Select **More actions**(•••), then **Convert to** **work item.**

3. Select a new work type, then select **Next**.

4. If the subtask's current status is not an allowed status for the new work type, **Step 2. Select new status** is displayed. Select a new status, then **Next**.

5. In **Step 3. Update fields**, complete any additional fields. If there’s no change, all fields will be updated automatically. Select **Next**.

6. Review your changes, then select **Finish**.

7. The new work item will be displayed, without a parent work item linked at the top of the screen.


In a team-managed space, the process is slightly different:

1. From the subtask you want to convert, select **More actions**(•••), then **Move**.

2. On the table that appears, use the dropdown to change the work type. Select **Next** to continue.

3. If required, you'll be prompted to enter any additional fields. To update those watching the space, check **Send mail for this update**, or leave it unchecked. Select **Next** to continue.

4. Review your changes, then select **Confirm**.

5. Once the work item is migrated, select **Acknowledge**.


### Convert a work item to a subtask

You can't convert a work item to a subtask if the work item has subtasks of its own. First, convert the work item’s subtasks to standalone work items, then you convert them to subtasks of another work item.

Subtasks also can't be moved directly from one work item to another. Convert them to standalone work items first, then to subtasks of their new parent work item.

To convert a work item to a subtask in a team-managed spaces, use the procedure to **Convert a subtask to a work item**. On step 2, select **Subtask**.

In a company-managed space:

1. Open the work item and select on the work type icon at the top-left

2. Select **Subtask** from the list of available work types

3. Select the parent work item for the new subtask

4. Follow the steps, then select **Finish** to create the subtask.


* * *

## Restrict access to work items in software spaces

While we recommend working openly, there are times where you may want to restrict who can view a particular piece of work. For example, you may want to restrict who can view tasks related to sensitive financial information, hiring or other personal employment information, or security-related software engineering work.

You can't edit space permissions or roles on the Free plan in Jira, and you can't configure work-level security on any Free plan.

To take advantage of Jira's powerful space permission management features, [upgrade your plan](https://support.atlassian.com/jira-cloud-administration/docs/explore-jira-cloud-plans/ "https://support.atlassian.com/jira-cloud-administration/docs/explore-jira-cloud-plans/").

### Restrict access to a work item in a company-managed space

In company-managed spaces, you can restrict access by setting a security level to the work item.

To set the security level on work items in company-managed spaces:

1. Choose the lock icon at the top-right of the work item. This icon only appears if the space has a security scheme configured.

2. Select the desired security level.


You can also remove a security level by selecting the lock icon and selecting **Remove security level**.

Jira admins can add, edit, or remove security levels (and their membership) through work item security schemes. [Find out about work item security schemes](https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-security-schemes/ "https://support.atlassian.com/jira-cloud-administration/docs/configure-issue-security-schemes/").

### Restrict access to a work item in a team-managed space

In team-managed software spaces, you can restrict access to specific roles in your space.

To restrict access, you must have a role with the **Restrict any work item** permission in the space. [Find out more about roles and permissions in team-managed](https://support.atlassian.com/jira-software-cloud/docs/add-people-to-team-managed-projects/ "https://support.atlassian.com/jira-software-cloud/docs/add-people-to-team-managed-projects/") spaces.

To restrict access when creating a work item:

1. Select **\+ Create** from the navigation bar.

2. Complete any required fields for the work item.

3. Select the **Restrict to** field in the list of fields.

4. Select the roles you want to allow to see the work item from the dropdown.

5. Select **Create**.


To restrict a work item to certain roles, you’ll have to create the work item using the above steps. If you create a work item using any other method, it won’t be restricted.

If you create a subtask of a work item that has restrictions, then the subtask will inherit the restrictions from the parent work item. You won’t be able to change the restrictions of the subtask individually. To set restrictions to subtasks, you will have to update the restrictions for the parent work item.

To restrict access after a work item is created:

1. Choose the lock icon at the top-right of the work item.

2. Select the roles you want to allow to see the work item from the dropdown.

3. Select **Restrict**.


You can also remove roles by selecting the cross ( **X)** next to the role’s name in the menu.

Team-managed space admins can add, edit, or remove roles and their membership in the **Access** page. Go to **Space** **settings** by selecting the more actions () menu in the sidebar, then select **Access**. [Find out more about roles and permissions in team-managed](https://support.atlassian.com/jira-software-cloud/docs/add-people-to-team-managed-projects/ "https://support.atlassian.com/jira-software-cloud/docs/add-people-to-team-managed-projects/") spaces.

While bulk moving work items from a company-managed space to a team-managed space, your work items will get moved without any restrictions and these become open.

Deleting a custom role that has associated work items restrictions will make the work items unaccessible to the role. For instance, if there is a custom role Developer, and the work items are only restricted to this role, then the work items become unaccessible when the role is deleted. If the work items are restricted to a set of roles which includes Developer, then the work items can be accessed by other roles when Developer role is deleted.

* * *

## Delete a work item

You must have the following to do the things described on this page.

**Permission:** Delete work items

To delete a work item:

1. Navigate to the work item.

2. Select **More actions** **(** **)**, then select **Delete**.


Was this helpful?

Yes

No

It wasn't accurateIt wasn't clearIt wasn't relevant

Provide feedback about this article

## Still need help?

The Atlassian Community is here for you.

[Ask the Community](https://community.atlassian.com/t5/custom/page/page-id/create-post-step-1?add-tags=jira-software,Cloud)